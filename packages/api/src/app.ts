import { fileURLToPath } from "node:url";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { env } from "./env.js";
import { registerStaticFiles } from "./staticFiles.js";
import { authRoutes } from "./routes/auth.js";
import { accountRoutes } from "./routes/accounts.js";
import { budgetRoutes } from "./routes/budgets.js";
import { categoryRoutes } from "./routes/categories.js";
import { insightsRoutes } from "./routes/insights.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { folderSyncRoutes } from "./routes/folderSync.js";
import { reviewRoutes } from "./routes/review.js";
import { notificationRoutes } from "./routes/notifications.js";
import { piggyBankRoutes } from "./routes/piggybank.js";
import { simplefinRoutes } from "./routes/simplefin.js";
import { transactionRoutes } from "./routes/transactions.js";
import { userRoutes } from "./routes/users.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });

  await app.register(cookie, { secret: env.SESSION_SECRET });

  app.get("/health", async () => ({ status: "ok", time: new Date().toISOString() }));

  // Encapsulated so CORS headers only ever attach to /api/* responses — in
  // single-port mode the frontend is same-origin with the API and doesn't
  // need them, and sending them on plain static/HTML responses is at best
  // noise and at worst confuses clients that don't expect CORS headers on a
  // top-level document fetch.
  await app.register(async (api) => {
    await api.register(cors, { origin: env.CORS_ORIGINS, credentials: true });

    await api.register(authRoutes, { prefix: "/api/auth" });
    await api.register(userRoutes, { prefix: "/api/users" });
    await api.register(accountRoutes, { prefix: "/api/accounts" });
    await api.register(dashboardRoutes, { prefix: "/api/dashboard" });
    await api.register(notificationRoutes, { prefix: "/api/notifications" });
    await api.register(simplefinRoutes, { prefix: "/api/simplefin" });
    await api.register(transactionRoutes, { prefix: "/api/transactions" });
    await api.register(piggyBankRoutes, { prefix: "/api/piggybank" });
    await api.register(categoryRoutes, { prefix: "/api/categories" });
    await api.register(budgetRoutes, { prefix: "/api/budgets" });
    await api.register(insightsRoutes, { prefix: "/api/insights" });
    await api.register(folderSyncRoutes, { prefix: "/api/folder-sync" });
    await api.register(reviewRoutes, { prefix: "/api/review" });
  });

  // Single-port deploy: also serve the built web app (LAN / NAS).
  if (env.SERVE_WEB) {
    const webRoot = fileURLToPath(new URL("../../web/dist", import.meta.url));
    registerStaticFiles(app, webRoot);
    app.log.info(`Serving web app from ${webRoot}`);
  }

  return app;
}
