import { PrismaClient } from "@prisma/client";

const readOps = new Set(["findMany", "findFirst", "count", "aggregate", "groupBy"]);

// Soft-delete filter for Transaction: every list/aggregate read excludes
// deleted rows automatically, so no call site can forget deletedAt: null and
// silently leak a "this was wrong, I removed it" row into a balance/report
// total. Applies only to direct prisma.transaction.* calls — there's
// currently no code that reads transactions via a relation include (e.g.
// account.findMany({ include: { transactions: true } })), which would bypass
// this; keep it that way, or filter deletedAt explicitly if that changes.
// To see deleted rows (sync's externalId dedupe check, the pending-shadow
// candidate query), pass `deletedAt: undefined` explicitly in `where` — the
// key-presence check below still finds it and skips auto-injection.
export const prisma = new PrismaClient().$extends({
  query: {
    transaction: {
      async $allOperations({ operation, args, query }) {
        if (readOps.has(operation)) {
          const a = args as { where?: Record<string, unknown> };
          if (!("deletedAt" in (a.where ?? {}))) {
            a.where = { ...a.where, deletedAt: null };
          }
        }
        return query(args);
      },
    },
  },
});
