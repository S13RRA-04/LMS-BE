import "dotenv/config";
import { loadConfig } from "../config/config.js";
import { closeMongoClient, getMongoDb } from "./mongo.js";
import { renamePactChallengeLabels } from "./migrations/renamePactChallengeLabels.js";

const config = loadConfig(process.env);

try {
  const result = await renamePactChallengeLabels(await getMongoDb(config), config);
  console.log(JSON.stringify({
    migration: "rename-pact-challenge-labels",
    database: config.mongoDbName,
    collectionPrefix: config.mongoCollectionPrefix,
    ...result
  }, null, 2));
} finally {
  await closeMongoClient();
}
