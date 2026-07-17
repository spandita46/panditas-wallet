import argon2 from "argon2";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Role } from "@panditas/shared";
import { prisma } from "./db.js";

const SESSION_COOKIE = "sid";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

export function hashSecret(secret: string): Promise<string> {
  return argon2.hash(secret, { type: argon2.argon2id });
}

export function verifySecret(hash: string, secret: string): Promise<boolean> {
  return argon2.verify(hash, secret);
}

export async function createSession(
  reply: FastifyReply,
  userId: string,
  userAgent?: string,
): Promise<void> {
  const session = await prisma.session.create({
    data: {
      userId,
      userAgent: userAgent ?? null,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });
  reply.setCookie(SESSION_COOKIE, session.id, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    signed: true,
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export async function destroySession(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const raw = request.cookies[SESSION_COOKIE];
  if (raw) {
    const unsigned = request.unsignCookie(raw);
    if (unsigned.valid && unsigned.value) {
      await prisma.session.deleteMany({ where: { id: unsigned.value } });
    }
  }
  reply.clearCookie(SESSION_COOKIE, { path: "/" });
}

export interface AuthUser {
  id: string;
  name: string;
  role: Role;
}

export async function loadUser(request: FastifyRequest): Promise<AuthUser | null> {
  const raw = request.cookies[SESSION_COOKIE];
  if (!raw) return null;
  const unsigned = request.unsignCookie(raw);
  if (!unsigned.valid || !unsigned.value) return null;

  const session = await prisma.session.findUnique({
    where: { id: unsigned.value },
    include: { user: true },
  });
  if (!session || session.expiresAt < new Date() || !session.user.isActive) return null;

  return { id: session.user.id, name: session.user.name, role: session.user.role as Role };
}

// preHandler guards -------------------------------------------------------

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const user = await loadUser(request);
  if (!user) {
    reply.code(401).send({ error: "Not authenticated" });
    return;
  }
  request.user = user;
}

export function requireRole(...roles: Role[]) {
  return async function (request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const user = await loadUser(request);
    if (!user) {
      reply.code(401).send({ error: "Not authenticated" });
      return;
    }
    if (!roles.includes(user.role)) {
      reply.code(403).send({ error: "Forbidden" });
      return;
    }
    request.user = user;
  };
}
