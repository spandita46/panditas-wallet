import { readFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import {
  folderSyncApproveSchema,
  type ImportPreviewResponse,
  type ImportRow,
  type PendingImportDetail,
  type PendingImportSummary,
} from "@panditas/shared";
import { requireRole } from "../auth.js";
import { prisma } from "../db.js";
import { commitImportRows, previewImportRows } from "../importCore.js";
import { env } from "../env.js";
import { scanFolder } from "../folderSync/scan.js";
import type { ColumnMapping } from "../folderSync/normalize.js";
import { toPendingImportSummaryDTO } from "../mappers.js";

const RESOLVED_STATUSES = ["committed", "rejected"] as const;

// Agent-assisted transaction import from a watched folder — dropped bank
// export files (CSV/XLSX/PDF) get parsed and staged for review, never
// auto-committed. Admin-only, same as other bulk data operations.
export async function folderSyncRoutes(app: FastifyInstance): Promise<void> {
  app.post("/scan", { preHandler: requireRole("admin") }, async (_request, reply) => {
    if (!env.FOLDER_SYNC_DIR) {
      return reply.code(400).send({ error: "FOLDER_SYNC_DIR is not configured — folder sync is unavailable." });
    }
    try {
      return await scanFolder();
    } catch (err) {
      // A bad/unreadable directory is a config problem, not a server error —
      // surface it as a clear 400 rather than an opaque 500.
      return reply.code(400).send({ error: err instanceof Error ? err.message : "Scan failed." });
    }
  });

  app.get("/pending", { preHandler: requireRole("admin") }, async (request) => {
    const { includeResolved } = z.object({ includeResolved: z.string().optional() }).parse(request.query);
    const pending = await prisma.pendingImport.findMany({
      where: includeResolved === "1" ? {} : { status: { notIn: [...RESOLVED_STATUSES] } },
      include: { account: { select: { name: true, label: true } } },
      orderBy: { createdAt: "desc" },
    });
    const result: PendingImportSummary[] = pending.map(toPendingImportSummaryDTO);
    return result;
  });

  app.get("/pending/:id", { preHandler: requireRole("admin") }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const { accountId: accountIdOverride } = z.object({ accountId: z.string().optional() }).parse(request.query);

    const pending = await prisma.pendingImport.findUnique({
      where: { id },
      include: { account: { select: { name: true, label: true } } },
    });
    if (!pending) return reply.code(404).send({ error: "Not found" });

    const rows = (pending.rows as unknown as ImportRow[]) ?? [];
    const effectiveAccountId = accountIdOverride ?? pending.accountId;

    const preview: ImportPreviewResponse =
      effectiveAccountId && rows.length > 0
        ? await previewImportRows(effectiveAccountId, rows)
        : {
            rows: rows.map((r, index) => ({
              index,
              postedAt: r.postedAt,
              amount: r.amount,
              payee: r.payee ?? null,
              memo: r.memo ?? null,
              duplicate: false,
            })),
            duplicateCount: 0,
          };

    const detail: PendingImportDetail = { ...toPendingImportSummaryDTO(pending), preview };
    return detail;
  });

  app.post("/pending/:id/approve", { preHandler: requireRole("admin") }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const parsed = folderSyncApproveSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input" });
    const { accountId, rows } = parsed.data;
    const user = request.user!;

    const pending = await prisma.pendingImport.findUnique({ where: { id } });
    if (!pending) return reply.code(404).send({ error: "Not found" });
    if (RESOLVED_STATUSES.includes(pending.status as (typeof RESOLVED_STATUSES)[number])) {
      return reply.code(400).send({ error: "This file has already been resolved." });
    }

    const account = await prisma.account.findUnique({ where: { id: accountId } });
    if (!account) return reply.code(404).send({ error: "Account not found" });

    const response = await commitImportRows(accountId, rows, "import_folder_sync");

    await prisma.pendingImport.update({
      where: { id },
      data: { status: "committed", accountId, reviewedAt: new Date(), reviewedByUserId: user.id },
    });

    // Teaching the cache: never from the agent's raw guess, only on a
    // human-confirmed approve. Two things get taught, independently:
    //  - The column mapping itself — only for a file whose structure came
    //    from the agent (cache-miss), gated on headerFingerprint/columnMapping
    //    having been captured at scan time (CSV only; xlsx/pdf leave these null).
    //  - A multi-account file's raw-account-id -> Account.id hint — taught
    //    on ANY approve of a split row (rawAccountId set), including a
    //    cache-hit row, since a newly-seen raw account id under an
    //    already-recognized file format still needs a hint before the next
    //    scan can resolve it without an agent call.
    if (pending.fileType === "csv" && pending.headerFingerprint) {
      if (pending.mappingSource === "agent" && pending.columnMapping) {
        const mapping = pending.columnMapping as unknown as (ColumnMapping & {
          accountColumn: number | null;
          accountTypeColumn: number | null;
          institutionGuess: string | null;
        });
        const existingMapping = await prisma.folderSyncMapping.findUnique({ where: { headerFingerprint: pending.headerFingerprint } });
        const existingHints = (existingMapping?.accountIdHints as Record<string, string> | null) ?? {};
        const accountIdHints = pending.rawAccountId ? { ...existingHints, [pending.rawAccountId]: accountId } : existingHints;

        await prisma.folderSyncMapping.upsert({
          where: { headerFingerprint: pending.headerFingerprint },
          create: {
            headerFingerprint: pending.headerFingerprint,
            // Used to scope multi-account candidate narrowing to the right
            // institution on future scans of this same file format.
            sourceLabel: mapping.institutionGuess,
            dateColumn: mapping.dateColumn,
            dateFormat: mapping.dateFormat,
            payeeColumn: mapping.payeeColumn,
            memoColumn: mapping.memoColumn,
            amountMode: mapping.amountMode,
            amountColumn: mapping.amountColumn,
            flipSign: mapping.flipSign,
            debitColumn: mapping.debitColumn,
            creditColumn: mapping.creditColumn,
            accountColumn: mapping.accountColumn,
            accountTypeColumn: mapping.accountTypeColumn,
            // A multi-account file has no single "the" account to suggest —
            // only teach suggestedAccountId for an ordinary single-account file.
            suggestedAccountId: pending.rawAccountId ? null : accountId,
            accountIdHints: Object.keys(accountIdHints).length > 0 ? (accountIdHints as unknown as Prisma.InputJsonValue) : undefined,
          },
          update: {
            sourceLabel: mapping.institutionGuess ?? existingMapping?.sourceLabel ?? null,
            dateColumn: mapping.dateColumn,
            dateFormat: mapping.dateFormat,
            payeeColumn: mapping.payeeColumn,
            memoColumn: mapping.memoColumn,
            amountMode: mapping.amountMode,
            amountColumn: mapping.amountColumn,
            flipSign: mapping.flipSign,
            debitColumn: mapping.debitColumn,
            creditColumn: mapping.creditColumn,
            accountColumn: mapping.accountColumn,
            accountTypeColumn: mapping.accountTypeColumn,
            suggestedAccountId: pending.rawAccountId ? (existingMapping?.suggestedAccountId ?? null) : accountId,
            accountIdHints: accountIdHints as unknown as Prisma.InputJsonValue,
            lastUsedAt: new Date(),
          },
        });
      } else if (pending.mappingSource === "cache_hit" && pending.mappingCacheId && pending.rawAccountId) {
        const existingMapping = await prisma.folderSyncMapping.findUnique({ where: { id: pending.mappingCacheId } });
        const existingHints = (existingMapping?.accountIdHints as Record<string, string> | null) ?? {};
        await prisma.folderSyncMapping.update({
          where: { id: pending.mappingCacheId },
          data: { accountIdHints: { ...existingHints, [pending.rawAccountId]: accountId } as unknown as Prisma.InputJsonValue },
        });
      }
    }

    return reply.code(201).send(response);
  });

  app.post("/pending/:id/reject", { preHandler: requireRole("admin") }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const user = request.user!;

    const pending = await prisma.pendingImport.findUnique({ where: { id } });
    if (!pending) return reply.code(404).send({ error: "Not found" });
    if (RESOLVED_STATUSES.includes(pending.status as (typeof RESOLVED_STATUSES)[number])) {
      return reply.code(400).send({ error: "This file has already been resolved." });
    }

    await prisma.pendingImport.update({
      where: { id },
      data: { status: "rejected", reviewedAt: new Date(), reviewedByUserId: user.id },
    });
    return reply.code(204).send();
  });

  // Raw file bytes, re-read from FOLDER_SYNC_DIR at request time — v1 doesn't
  // archive/move processed files, so the original stays right where it was
  // scanned. Lets a CSV parse_failed be re-run through the manual Import.tsx
  // flow unchanged.
  app.get("/pending/:id/file", { preHandler: requireRole("admin") }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const pending = await prisma.pendingImport.findUnique({ where: { id } });
    if (!pending) return reply.code(404).send({ error: "Not found" });
    if (!env.FOLDER_SYNC_DIR) {
      return reply.code(400).send({ error: "FOLDER_SYNC_DIR is not configured — folder sync is unavailable." });
    }

    try {
      const bytes = await readFile(path.join(env.FOLDER_SYNC_DIR, pending.fileName));
      return reply.header("Content-Disposition", `attachment; filename="${pending.fileName}"`).send(bytes);
    } catch {
      return reply.code(404).send({ error: "The original file is no longer in the folder sync directory." });
    }
  });
}
