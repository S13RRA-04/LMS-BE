import "dotenv/config";
import { loadConfig } from "../config/config.js";
import { closeMongoClient, ensureMongoCollections } from "./mongo.js";

const config = loadConfig(process.env);

try {
  await ensureMongoCollections(config);
  await closeMongoClient();
  console.log(`Mongo collections are ready in ${config.mongoDbName} with prefix "${config.mongoCollectionPrefix}"`);
} catch (error) {
  await closeMongoClient();
  throw error;
}
