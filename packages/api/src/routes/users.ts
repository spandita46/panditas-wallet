import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createUserSchema, ROLES } from "@panditas/shared";
import { prisma } from "../db.js";
import { hashSecret, requireRole } from "../auth.js";

const updateUserSchema = z.object({
  name: z.string().min(1).optional(),
  role: z.enum(ROLES).optional(),
  avatarEmoji: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(8).optional(),
  pin: z.string().min(4).max(8).optional(),
});

export async function userRoutes(app: FastifyInstance): Promise<void> {
  // Minimal family roster (id/name/role only) for adults — used to tag "who a
  // transaction was for" without exposing email/active-status admin data.
  app.get("/lookup", { preHandler: requireRole("admin", "adult") }, async () => {
    const users = await prisma.user.findMany({
      where: { isActive: true },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, role: true, avatarEmoji: true },
    });
    return users;
  });

  // Admin-only: create a user and assign a role.
  app.post("/", { preHandler: requireRole("admin") }, async (request, reply) => {
    const parsed = createUserSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input" });
    const { name, role, email, password, pin, avatarEmoji } = parsed.data;

    if (role === "kid" && !pin) {
      return reply.code(400).send({ error: "Kids need a PIN" });
    }
    if (role !== "kid" && (!email || !password)) {
      return reply.code(400).send({ error: "Adults need an email and password" });
    }

    const user = await prisma.user.create({
      data: {
        name,
        role,
        email: email ?? null,
        avatarEmoji: avatarEmoji ?? null,
        passwordHash: password ? await hashSecret(password) : null,
        pinHash: pin ? await hashSecret(pin) : null,
      },
    });
    return reply.code(201).send({ id: user.id, name: user.name, role: user.role });
  });

  // Admin-only: the family user list (owner assignment lives in admin-only Settings).
  app.get("/", { preHandler: requireRole("admin") }, async () => {
    const users = await prisma.user.findMany({ orderBy: { createdAt: "asc" } });
    return users.map((u) => ({
      id: u.id,
      name: u.name,
      role: u.role,
      email: u.email,
      avatarEmoji: u.avatarEmoji,
      isActive: u.isActive,
    }));
  });

  // Admin-only: edit a user (deactivate/reactivate, change role/name/avatar, reset password/PIN).
  app.patch("/:id", { preHandler: requireRole("admin") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateUserSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input" });
    const { name, role, avatarEmoji, isActive, password, pin } = parsed.data;

    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: "User not found" });

    const user = await prisma.user.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(role !== undefined && { role }),
        ...(avatarEmoji !== undefined && { avatarEmoji }),
        ...(isActive !== undefined && { isActive }),
        ...(password && { passwordHash: await hashSecret(password) }),
        ...(pin && { pinHash: await hashSecret(pin) }),
      },
    });
    return { id: user.id, name: user.name, role: user.role, isActive: user.isActive };
  });
}
