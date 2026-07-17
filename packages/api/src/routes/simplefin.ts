import type { FastifyInstance } from "fastify";
import { connectSimplefinSchema } from "@panditas/shared";
import { z } from "zod";
import { prisma } from "../db.js";
import { encrypt } from "../crypto.js";
import { requireRole } from "../auth.js";
import { claimAccessUrl } from "../simplefin.js";
import { syncAll } from "../sync.js";

const claimSchema = z.object({ setupToken: z.string().min(1), label: z.string().optional() });

export async function simplefinRoutes(app: FastifyInstance): Promise<void> {
  // Admin submits a one-time SimpleFIN setup token; we claim it and store the
  // resulting access URL encrypted, then run a first sync.
  app.post("/claim", { preHandler: requireRole("admin") }, async (request, reply) => {
    const parsed = claimSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "A setup token is required" });

    let accessUrl: string;
    try {
      accessUrl = await claimAccessUrl(parsed.data.setupToken);
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : "Claim failed" });
    }

    const connection = await prisma.simplefinConnection.create({
      data: {
        label: parsed.data.label ?? null,
        accessUrlEncrypted: encrypt(accessUrl),
        status: "running",
      },
    });

    const summary = await syncAll();
    return reply.code(201).send({ connectionId: connection.id, summary });
  });

  // Alternative: paste an already-claimed access URL directly (admin).
  app.post("/connect", { preHandler: requireRole("admin") }, async (request, reply) => {
    const parsed = connectSimplefinSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "A valid access URL is required" });
    const connection = await prisma.simplefinConnection.create({
      data: { accessUrlEncrypted: encrypt(parsed.data.accessUrl), status: "running" },
    });
    const summary = await syncAll();
    return reply.code(201).send({ connectionId: connection.id, summary });
  });

  // Connection + institution health for the settings screen. Admin-only config.
  app.get("/status", { preHandler: requireRole("admin") }, async () => {
    const [connections, institutions, lastRun] = await Promise.all([
      prisma.simplefinConnection.findMany({ orderBy: { createdAt: "asc" } }),
      prisma.institution.findMany({
        where: { provider: "simplefin" },
        orderBy: { name: "asc" },
        include: { _count: { select: { accounts: true } } },
      }),
      prisma.syncRun.findFirst({ orderBy: { startedAt: "desc" } }),
    ]);
    return {
      connections: connections.map((c) => ({
        id: c.id,
        label: c.label,
        status: c.status,
        statusMessage: c.statusMessage,
        lastSyncedAt: c.lastSyncedAt?.toISOString() ?? null,
      })),
      institutions: institutions.map((i) => ({
        id: i.id,
        name: i.name,
        status: i.status,
        accountCount: i._count.accounts,
        lastSyncedAt: i.lastSyncedAt?.toISOString() ?? null,
      })),
      lastRun: lastRun
        ? {
            status: lastRun.status,
            message: lastRun.message,
            accountsUpdated: lastRun.accountsUpdated,
            transactionsAdded: lastRun.transactionsAdded,
            finishedAt: lastRun.finishedAt?.toISOString() ?? null,
          }
        : null,
    };
  });

  // Manual "Sync now".
  app.post("/sync", { preHandler: requireRole("admin", "adult") }, async () => {
    return syncAll();
  });

  app.delete("/connections/:id", { preHandler: requireRole("admin") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await prisma.simplefinConnection.delete({ where: { id } }).catch(() => null);
    return reply.code(204).send();
  });
}
