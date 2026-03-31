import app from "./app";
import { logger } from "./lib/logger";
import { connectMongo } from "./lib/mongo";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

let server: ReturnType<typeof app.listen> | null = null;

async function start() {
  await connectMongo();

  server = app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");
  });

  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;
}

async function shutdown(signal: string) {
  logger.info({ signal }, "Received shutdown signal");
  if (server) {
    server.close(() => {
      logger.info("Server closed gracefully");
      process.exit(0);
    });
    setTimeout(() => {
      logger.warn("Forcefully shutting down");
      process.exit(1);
    }, 10000);
  } else {
    process.exit(0);
  }
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

start().catch((err) => {
  logger.error({ err }, "Failed to start server");
  process.exit(1);
});
