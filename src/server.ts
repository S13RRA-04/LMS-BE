import "dotenv/config";
import { createApp } from "./app.js";
import { loadConfig } from "./config/config.js";
import { ensureMongoCollections } from "./db/mongo.js";
import { createLogger } from "./logging/logger.js";

const config = loadConfig(process.env);
const logger = createLogger(config);
const app = createApp(config, logger);

await ensureMongoCollections(config);

app.listen(config.port, () => {
  logger.info(
    { port: config.port, mongoDbName: config.mongoDbName, mongoCollectionPrefix: config.mongoCollectionPrefix },
    "CETU LMS API listening"
  );
});
