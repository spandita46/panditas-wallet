import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { env } from "./env.js";
import { authRoutes } from "./routes/auth.js";
import { accountRoutes } from "./routes/accounts.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { piggyBankRoutes } from "./routes/piggybank.js";
import { simplefinRoutes } from "./routes/simplefin.js";
import { transactionRoutes } from "./routes/transactions.js";
import { userRoutes } from "./routes/users.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });

  await app.register(cookie, { secret: env.SESSION_SECRET });
  await app.register(cors, { origin: env.CORS_ORIGINS, credentials: true });

  app.get("/health", async () => ({ status: "ok", time: new Date().toISOString() }));

  await app.register(authRoutes, { prefix: "/api/auth" });
  await app.register(userRoutes, { prefix: "/api/users" });
  await app.register(accountRoutes, { prefix: "/api/accounts" });
  await app.register(dashboardRoutes, { prefix: "/api/dashboard" });
  await app.register(simplefinRoutes, { prefix: "/api/simplefin" });
  await app.register(transactionRoutes, { prefix: "/api/transactions" });
  await app.register(piggyBankRoutes, { prefix: "/api/piggybank" });

  return app;
}
