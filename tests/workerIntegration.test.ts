import { exportJWK, exportPKCS8, generateKeyPair } from "jose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import worker from "../src/worker.js";
import { closeMongoClient, ensureMongoCollections } from "../src/db/mongo.js";
import { loadConfig } from "../src/config/config.js";

describe("LMS Cloudflare Worker integration", () => {
  let mongo: MongoMemoryServer;
  let env: Record<string, string>;

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    const platformKeys = await generateKeyPair("RS256");
    const toolKeys = await generateKeyPair("RS256");
    const toolPublicJwk = await exportJWK(toolKeys.publicKey);

    env = {
      NODE_ENV: "test",
      PORT: "1",
      APP_BASE_URL: "https://lms-worker.example.test",
      MONGO_URI: mongo.getUri(),
      MONGO_DB_NAME: "CETU_WORKER_TEST",
      MONGO_COLLECTION_PREFIX: "worker_test_",
      KEYCLOAK_ISSUER: "https://keycloak.example.test/realms/cetu",
      KEYCLOAK_AUDIENCE: "cetu-lms-api",
      KEYCLOAK_JWKS_URI: "https://keycloak.example.test/realms/cetu/protocol/openid-connect/certs",
      LTI_ISSUER: "https://lms-worker.example.test",
      LTI_PLATFORM_KID: "worker-test-platform-key",
      LTI_PLATFORM_PRIVATE_KEY_PEM: await exportPKCS8(platformKeys.privateKey),
      LTI_TOOLS_JSON: JSON.stringify([
        {
          clientId: "pact-tool",
          name: "PACT",
          deploymentIds: ["pact-course-deployment"],
          redirectUris: ["https://pact.example.test/lti/launch"],
          deepLinkRedirectUris: ["https://pact.example.test/lti/deep-link"],
          targetLinkUri: "https://pact.example.test/lti/launch",
          publicJwks: { keys: [{ ...toolPublicJwk, kid: "pact-tool-key", alg: "RS256", use: "sig" }] },
          scopes: []
        }
      ]),
      CORS_ORIGINS: "https://lms.example.test"
    };

    await ensureMongoCollections(loadConfig(env));
  });

  afterAll(async () => {
    await closeMongoClient();
    await mongo.stop();
  });

  it("serves health from the Worker runtime", async () => {
    const response = await worker.fetch(new Request("https://lms-worker.example.test/health"), env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, runtime: "cloudflare-workers" });
  });

  it("uses Mongo-backed services for admin course creation", async () => {
    const response = await worker.fetch(
      new Request("https://lms-worker.example.test/api/v1/lms/admin/courses", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-dev-user-id": "admin-user",
          "x-dev-user-roles": "admin",
          "x-request-id": "worker-admin-create"
        },
        body: JSON.stringify({
          id: "worker-pact",
          slug: "worker-pact",
          title: "Worker PACT",
          description: "Worker-backed PACT launch course.",
          type: "lti_tool",
          status: "published",
          category: "Cyber Operations",
          departmentIds: ["cyber-training"],
          allowSelfEnrollment: false,
          estimatedMinutes: 120,
          ltiToolClientId: "pact-tool"
        })
      }),
      env
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ id: "worker-pact", title: "Worker PACT" });
  });

  it("enforces enrollment for learner LTI launches through the Worker", async () => {
    const blocked = await worker.fetch(
      new Request("https://lms-worker.example.test/api/v1/lms/courses/worker-pact/launch", {
        method: "POST",
        headers: {
          "x-dev-user-id": "learner-without-enrollment",
          "x-dev-user-roles": "learner"
        }
      }),
      env
    );

    expect(blocked.status).toBe(403);

    const enrolled = await worker.fetch(
      new Request("https://lms-worker.example.test/api/v1/lms/admin/enrollments", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-dev-user-id": "admin-user",
          "x-dev-user-roles": "admin"
        },
        body: JSON.stringify({
          userId: "learner-1",
          courseId: "worker-pact",
          cohortId: "worker-cohort",
          status: "in_progress",
          progressPercent: 0
        })
      }),
      env
    );
    expect(enrolled.status).toBe(201);

    const launch = await worker.fetch(
      new Request("https://lms-worker.example.test/api/v1/lms/courses/worker-pact/launch", {
        method: "POST",
        headers: {
          "x-dev-user-id": "learner-1",
          "x-dev-user-roles": "learner",
          "x-dev-user-email": "learner@example.test",
          "x-dev-user-name": "Learner One"
        }
      }),
      env
    );

    expect(launch.status).toBe(200);
    expect(launch.headers.get("content-type")).toContain("text/html");
    await expect(launch.text()).resolves.toContain("id_token");
  });
});
