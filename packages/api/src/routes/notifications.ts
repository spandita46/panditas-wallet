import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { requireRole } from "../auth.js";
import { listNotifications } from "../notificationCenter.js";

export async function notificationRoutes(app: FastifyInstance): Promise<void> {
  // Full history — active and dismissed — for the bell/drawer. The
  // Dashboard's own banner strip uses the shorter active-only list embedded
  // in GET /dashboard/summary instead of this endpoint.
  app.get("/", { preHandler: requireRole("admin", "adult") }, async () => {
    return listNotifications();
  });

  // Move a notification from the Dashboard banner into the drawer — still
  // visible there until "Clear all".
  app.post("/:id/dismiss", { preHandler: requireRole("admin", "adult") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await prisma.notification.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: "Notification not found" });
    await prisma.notification.update({ where: { id }, data: { dismissedAt: new Date() } });
    return reply.code(204).send();
  });

  // Wipe every notification, active or dismissed. A live condition that's
  // still true (e.g. an institution still stale) will simply reappear on the
  // next sync — this only clears the record, not the underlying problem.
  app.post("/clear-all", { preHandler: requireRole("admin", "adult") }, async () => {
    await prisma.notification.deleteMany({});
    return { cleared: true };
  });
}
