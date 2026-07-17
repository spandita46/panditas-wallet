import { fileURLToPath } from "node:url";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
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

  // Single-port deploy: also serve the built web app (LAN / NAS).
  if (env.SERVE_WEB) {
    const webRoot = fileURLToPath(new URL("../../web/dist", import.meta.url));
    await app.register(fastifyStatic, { root: webRoot, wildcard: false });
    // SPA fallback: any non-API GET returns index.html so client routes work on refresh.
    app.setNotFoundHandler((request, reply) => {
      if (request.method === "GET" && !request.url.startsWith("/api")) {
        return reply.sendFile("index.html");
      }
      return reply.code(404).send({ error: "Not found" });
    });
    app.log.info(`Serving web app from ${webRoot}`);
  }

  return app;
}
