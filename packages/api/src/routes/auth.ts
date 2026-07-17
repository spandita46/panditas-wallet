import type { FastifyInstance } from "fastify";
import { kidLoginSchema, loginSchema } from "@panditas/shared";
import { prisma } from "../db.js";
import { createSession, destroySession, loadUser, verifySecret } from "../auth.js";

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post("/login", async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input" });

    const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
    if (!user || !user.isActive || !user.passwordHash) {
      return reply.code(401).send({ error: "Invalid credentials" });
    }
    const ok = await verifySecret(user.passwordHash, parsed.data.password);
    if (!ok) return reply.code(401).send({ error: "Invalid credentials" });

    await createSession(reply, user.id, request.headers["user-agent"]);
    return { id: user.id, name: user.name, role: user.role };
  });

  // Kids sign in with a short PIN against their user id (no email).
  app.post("/kid-login", async (request, reply) => {
    const parsed = kidLoginSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input" });

    const user = await prisma.user.findUnique({ where: { id: parsed.data.userId } });
    if (!user || !user.isActive || user.role !== "kid" || !user.pinHash) {
      return reply.code(401).send({ error: "Invalid credentials" });
    }
    const ok = await verifySecret(user.pinHash, parsed.data.pin);
    if (!ok) return reply.code(401).send({ error: "Invalid credentials" });

    await createSession(reply, user.id, request.headers["user-agent"]);
    return { id: user.id, name: user.name, role: user.role };
  });

  app.post("/logout", async (request, reply) => {
    await destroySession(request, reply);
    return { ok: true };
  });

  app.get("/me", async (request, reply) => {
    const user = await loadUser(request);
    if (!user) return reply.code(401).send({ error: "Not authenticated" });
    return user;
  });
}
