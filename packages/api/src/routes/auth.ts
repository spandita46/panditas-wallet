import type { FastifyInstance } from "fastify";
import { loginSchema } from "@panditas/shared";
import { prisma } from "../db.js";
import { createSession, destroySession, loadUser, verifySecret } from "../auth.js";

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // Unified login: match by name OR email (case-insensitive), verify against a
  // password (adults/admin) or a PIN (kids).
  app.post("/login", async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input" });
    const { identifier, secret } = parsed.data;

    const candidates = await prisma.user.findMany({
      where: {
        isActive: true,
        OR: [
          { email: { equals: identifier, mode: "insensitive" } },
          { name: { equals: identifier, mode: "insensitive" } },
        ],
      },
    });

    for (const user of candidates) {
      const hash = user.passwordHash ?? user.pinHash;
      if (hash && (await verifySecret(hash, secret))) {
        await createSession(reply, user.id, request.headers["user-agent"]);
        return { id: user.id, name: user.name, role: user.role };
      }
    }
    return reply.code(401).send({ error: "Invalid credentials" });
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
