import type { Db } from "mongodb";
import type { AppConfig } from "../../config/config.js";
import { collectionNames } from "../mongo.js";

export const oldPactChallengeLabel = "PACT Squad Challenges";
export const newPactChallengeLabel = "PACT Challenges";

export async function renamePactChallengeLabels(db: Db, config: AppConfig) {
  const names = collectionNames(config);
  const now = new Date().toISOString();

  const lineItems = await db.collection(names.ltiLineItems).updateMany(
    { label: oldPactChallengeLabel },
    { $set: { label: newPactChallengeLabel, updatedAt: now } }
  );
  const contentItems = await db.collection(names.ltiContentItems).updateMany(
    { title: oldPactChallengeLabel },
    { $set: { title: newPactChallengeLabel, updatedAt: now } }
  );

  return {
    lineItemsMatched: lineItems.matchedCount,
    lineItemsModified: lineItems.modifiedCount,
    contentItemsMatched: contentItems.matchedCount,
    contentItemsModified: contentItems.modifiedCount
  };
}
