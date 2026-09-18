import { disconnectPrisma } from "@ai-study-companion/db";
import { createApp } from "./app.js";
import { config } from "./config/index.js";
import { logger } from "./lib/logger.js";
import { closeQueues } from "./lib/queues.js";
import { closeRateLimitRedis } from "./middleware/rateLimit.js";

const app = createApp();

const server = app.listen(config.PORT, () => {
  logger.info(
    {
      port: config.PORT,
      env: config.NODE_ENV,
      webUrl: config.WEB_URL,
    },
    `API listening on port ${config.PORT}`
  );
});

function shutdown(signal: string): void {
  logger.info({ signal }, "Shutting down API server");
  // Stop accepting new work first; in-flight requests drain via close().
  server.close(() => {
    void (async () => {
      try {
        // Release shared resources before exit: rate-limit Redis,
        // BullMQ producer queues, then the Prisma pool. Each close is
        // guarded so one stuck resource can't block the rest.
        await closeRateLimitRedis().catch((error: unknown) => {
          logger.warn({ error: String(error) }, "Rate-limit Redis close failed");
        });
        await closeQueues().catch((error: unknown) => {
          logger.warn({ error: String(error) }, "Queue close failed");
        });
        await disconnectPrisma().catch((error: unknown) => {
          logger.warn({ error: String(error) }, "Prisma disconnect failed");
        });
      } finally {
        process.exit(0);
      }
    })();
  });
  // Force-exit if graceful shutdown hangs.
  setTimeout(() => process.exit(0), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

export { app, server };
