import app from "./app";
import { logger } from "./lib/logger";
import { startIntelligenceEngine } from "./services/intelligence/worker";
import { startProductionEngine } from "./services/production/worker";
import { startTimelineEngine } from "./services/editor/render";
import { startDirectorEngine } from "./services/director/worker";

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

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  startIntelligenceEngine();
  startProductionEngine();
  startTimelineEngine();
  startDirectorEngine();
});
