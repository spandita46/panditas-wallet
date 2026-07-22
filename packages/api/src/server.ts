import { buildApp } from "./app.js";
import { env } from "./env.js";
import { startScheduler } from "./scheduler.js";

async function main(): Promise<void> {
  const app = await buildApp();
  try {
    await app.listen({ port: env.API_PORT, host: env.API_HOST });
    app.log.info(`${env.APP_NAME} API listening on ${env.API_HOST}:${env.API_PORT}`);
    startScheduler(app.log);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void main();
