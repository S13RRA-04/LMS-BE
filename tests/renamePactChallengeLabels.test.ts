import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppConfig } from "../src/config/config.js";
import { closeMongoClient, collectionNames, ensureMongoCollections, getMongoDb } from "../src/db/mongo.js";
import { newPactChallengeLabel, oldPactChallengeLabel, renamePactChallengeLabels } from "../src/db/migrations/renamePactChallengeLabels.js";

describe("rename PACT challenge labels migration", () => {
  let mongo: MongoMemoryServer;
  let config: AppConfig;

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    config = {
      env: "test",
      port: 1,
      appBaseUrl: "http://localhost:4000",
      ltiIssuer: "http://localhost:4000",
      mongoUri: mongo.getUri(),
      mongoDbName: "CETU_MIGRATION_TEST",
      mongoCollectionPrefix: "migration_test_",
      keycloakIssuer: "http://keycloak.test/realms/cetu",
      keycloakAudience: "cetu-lms-api",
      keycloakJwksUri: "http://keycloak.test/realms/cetu/protocol/openid-connect/certs",
      keycloakAdminRealm: "cetu",
      keycloakAdminTokenRealm: "cetu",
      ltiPlatformKid: "test-key",
      ltiPlatformPrivateKeyPem: "test-private-key",
      registeredTools: [],
      corsOrigins: []
    };
    await ensureMongoCollections(config);
  });

  afterAll(async () => {
    await closeMongoClient();
    await mongo.stop();
  });

  it("renames existing PACT challenge content and line-item labels idempotently", async () => {
    const db = await getMongoDb(config);
    const names = collectionNames(config);
    const now = new Date().toISOString();
    await db.collection(names.ltiLineItems).insertMany([
      { id: "challenge-line", label: oldPactChallengeLabel, scoreMaximum: 100, resourceId: "pact-challenge-hub", tag: "challenge", createdAt: now, updatedAt: now },
      { id: "module-line", label: "PACT Modules", scoreMaximum: 100, resourceId: "pact-module-hub", tag: "module", createdAt: now, updatedAt: now }
    ]);
    await db.collection(names.ltiContentItems).insertMany([
      { id: "challenge-content", toolClientId: "pact-tool", type: "ltiResourceLink", title: oldPactChallengeLabel, resourceId: "pact-challenge-hub", tag: "challenge", createdAt: now, updatedAt: now },
      { id: "module-content", toolClientId: "pact-tool", type: "ltiResourceLink", title: "PACT Modules", resourceId: "pact-module-hub", tag: "module", createdAt: now, updatedAt: now }
    ]);

    const firstRun = await renamePactChallengeLabels(db, config);
    const secondRun = await renamePactChallengeLabels(db, config);

    expect(firstRun).toMatchObject({
      lineItemsMatched: 1,
      lineItemsModified: 1,
      contentItemsMatched: 1,
      contentItemsModified: 1
    });
    expect(secondRun).toMatchObject({
      lineItemsMatched: 0,
      lineItemsModified: 0,
      contentItemsMatched: 0,
      contentItemsModified: 0
    });
    await expect(db.collection(names.ltiLineItems).findOne({ id: "challenge-line" })).resolves.toMatchObject({ label: newPactChallengeLabel });
    await expect(db.collection(names.ltiContentItems).findOne({ id: "challenge-content" })).resolves.toMatchObject({ title: newPactChallengeLabel });
    await expect(db.collection(names.ltiLineItems).findOne({ id: "module-line" })).resolves.toMatchObject({ label: "PACT Modules" });
  });
});
