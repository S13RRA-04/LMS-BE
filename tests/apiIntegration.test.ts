import http from "node:http";
import { generateKeyPair, exportJWK, SignJWT, type KeyLike } from "jose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import type { AppConfig } from "../src/config/config.js";
import { closeMongoClient, collectionNames, ensureMongoCollections, getMongoDb } from "../src/db/mongo.js";
import { createLogger } from "../src/logging/logger.js";

describe("LMS API integration", () => {
  let mongo: MongoMemoryServer;
  let jwksServer: http.Server;
  let jwksUrl: string;
  let privateKey: KeyLike;
  let toolPrivateKey: KeyLike;
  let toolPublicJwk: Record<string, unknown>;
  let config: AppConfig;

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    const keys = await generateKeyPair("RS256");
    privateKey = keys.privateKey;
    const publicJwk = await exportJWK(keys.publicKey);
    const toolKeys = await generateKeyPair("RS256");
    toolPrivateKey = toolKeys.privateKey;
    toolPublicJwk = await exportJWK(toolKeys.publicKey) as Record<string, unknown>;
    const jwks = { keys: [{ ...publicJwk, kid: "test-key", alg: "RS256", use: "sig" }] };

    jwksServer = http.createServer((_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(jwks));
    });
    await new Promise<void>((resolve) => jwksServer.listen(0, "127.0.0.1", resolve));
    const address = jwksServer.address();
    if (typeof address !== "object" || !address) {
      throw new Error("JWKS test server did not start");
    }
    jwksUrl = `http://127.0.0.1:${address.port}/certs`;

    config = testConfig(mongo.getUri(), jwksUrl, toolPublicJwk);
    await ensureMongoCollections(config);
  });

  afterAll(async () => {
    await closeMongoClient();
    await mongo.stop();
    await new Promise<void>((resolve, reject) => jwksServer.close((error) => (error ? reject(error) : resolve())));
  });

  it("upserts the internal user from Keycloak subject and writes audit log for admin course creation", async () => {
    const token = await signKeycloakToken(privateKey, config);
    const app = createApp(config, createLogger(config));

    const response = await request(app)
      .post("/api/v1/lms/admin/courses")
      .set("authorization", `Bearer ${token}`)
      .set("x-request-id", "integration-request")
      .send({
        id: "malware-analysis",
        slug: "malware-analysis",
        title: "Malware Analysis",
        description: "Analyze suspicious binaries and artifacts.",
        type: "online",
        status: "published",
        category: "Cyber Operations",
        departmentIds: ["cyber-training"],
        allowSelfEnrollment: true,
        estimatedMinutes: 90
      });

    expect(response.status).toBe(201);
    expect(response.body.id).toBe("malware-analysis");

    const db = await getMongoDb(config);
    const names = collectionNames(config);
    const user = await db.collection(names.users).findOne({ keycloakSub: "keycloak-admin-sub" });
    expect(user?.email).toBe("admin@example.test");
    expect(user?.role).toBe("admin");
    expect(user?.roles).toEqual(["admin"]);

    const auditLog = await db.collection(names.auditLogs).findOne({ action: "course.create" });
    expect(auditLog?.actorUserId).toBe(user?.id);
    expect(auditLog?.actorKeycloakSub).toBe("keycloak-admin-sub");
    expect(auditLog?.targetId).toBe("malware-analysis");
    expect(auditLog?.requestId).toBe("integration-request");
  });

  it("allows enrolled learners to launch an LTI course with cohort context", async () => {
    const app = createApp(config, createLogger(config));

    await request(app)
      .post("/api/v1/lms/admin/courses")
      .set("x-dev-user-id", "admin-user")
      .set("x-dev-user-roles", "admin")
      .send({
        id: "pact",
        slug: "pact",
        title: "PACT",
        description: "Practical cyber training course and tool launch.",
        type: "lti_tool",
        status: "published",
        category: "Cyber Operations",
        departmentIds: ["cyber-training"],
        allowSelfEnrollment: false,
        estimatedMinutes: 120,
        ltiToolClientId: "pact-tool"
      })
      .expect(201);

    await request(app)
      .post("/api/v1/lms/admin/enrollments")
      .set("x-dev-user-id", "admin-user")
      .set("x-dev-user-roles", "admin")
      .send({
        userId: "learner-1",
        courseId: "pact",
        cohortId: "cohort-alpha",
        status: "in_progress",
        progressPercent: 0
      })
      .expect(201);

    const launch = await request(app)
      .post("/api/v1/lms/courses/pact/launch")
      .set("x-dev-user-id", "learner-1")
      .set("x-dev-user-roles", "learner")
      .set("x-dev-user-email", "learner@example.test")
      .set("x-dev-user-name", "Learner One")
      .expect(200);

    expect(launch.headers["content-type"]).toContain("text/html");
    expect(launch.text).toContain("id_token");
    expect(launch.text).toContain("https://pact.example.test/lti/launch");
  });

  it("allows admins to initiate PACT Deep Linking for an LTI course", async () => {
    const app = createApp(config, createLogger(config));

    await request(app)
      .post("/api/v1/lms/admin/courses")
      .set("x-dev-user-id", "admin-user")
      .set("x-dev-user-roles", "admin")
      .send({
        id: "pact-deep-link",
        slug: "pact-deep-link",
        title: "PACT Deep Link",
        description: "Practical cyber training course and tool launch.",
        type: "lti_tool",
        status: "published",
        category: "Cyber Operations",
        departmentIds: ["cyber-training"],
        allowSelfEnrollment: false,
        estimatedMinutes: 120,
        ltiToolClientId: "pact-tool"
      })
      .expect(201);

    const response = await request(app)
      .post("/api/v1/lms/admin/courses/pact-deep-link/deep-link")
      .set("x-dev-user-id", "admin-user")
      .set("x-dev-user-roles", "admin")
      .send({ cohortId: "cohort-alpha" })
      .expect(200);

    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.text).toContain("id_token");
    expect(response.text).toContain("https://pact.example.test/lti/deep-link");

    await request(app)
      .post("/api/v1/lms/admin/courses/pact-deep-link/deep-link")
      .set("x-dev-user-id", "learner-1")
      .set("x-dev-user-roles", "learner")
      .send({ cohortId: "cohort-alpha" })
      .expect(403);
  });

  it("persists accepted PACT Deep Linking items as LMS content and line items", async () => {
    const app = createApp(config, createLogger(config));
    const jwt = await signDeepLinkResponse(toolPrivateKey, config);

    const accepted = await request(app)
      .post("/api/v1/lti/deep-linking/return")
      .type("form")
      .send({ JWT: jwt })
      .expect(200);

    expect(accepted.body.count).toBe(1);
    expect(accepted.body.accepted[0]).toMatchObject({
      toolClientId: "pact-tool",
      title: "PACT Squad Challenges",
      courseId: "pact",
      cohortId: "cohort-alpha"
    });

    const deepLinks = await request(app)
      .get("/api/v1/lms/admin/deep-links")
      .set("x-dev-user-id", "admin-user")
      .set("x-dev-user-roles", "admin")
      .expect(200);

    expect(deepLinks.body.contentItems).toHaveLength(1);
    expect(deepLinks.body.lineItems[0]).toMatchObject({
      label: "PACT Squad Challenges",
      scoreMaximum: 100,
      resourceId: "pact-challenge-hub",
      tag: "challenge"
    });
  });

  it("rejects unauthenticated Keycloak user sync events", async () => {
    const app = createApp(config, createLogger(config));

    await request(app)
      .post("/api/v1/keycloak/events")
      .send({ operationType: "UPDATE", resourcePath: "users/keycloak-user-1" })
      .expect(401);
  });
});

function testConfig(mongoUri: string, jwksUrl: string, toolPublicJwk: Record<string, unknown>): AppConfig {
  return {
    env: "test",
    port: 0,
    appBaseUrl: "http://localhost:4000",
    mongoUri,
    mongoDbName: "CETU",
    mongoCollectionPrefix: "staging_test_",
    keycloakIssuer: "http://keycloak.test/realms/cetu",
    keycloakAudience: "cetu-lms-api",
    keycloakJwksUri: jwksUrl,
    keycloakAdminBaseUrl: "http://keycloak.test",
    keycloakAdminRealm: "cetu",
    keycloakAdminTokenRealm: "cetu",
    keycloakWebhookSecret: "test-webhook-secret-with-enough-length",
    ltiIssuer: "http://localhost:4000",
    ltiPlatformKid: "test-platform-key",
    ltiPlatformPrivateKeyPem:
      "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDJo+4HVmM0MdQc\nuywa+88cPJUgftuMdbsXgoahtGu8gEbQu8RXObej+Vo1mnFmY5p0PCYb9zKusJq5\nLrrPfmzgcaIb85xrntCgu+eah1IV6gOLLYgQy2kbjiBplxohF3q8klMgG9Xr5XEG\nR6rlfAaP7cNI9e6fryUz2RXxAoVyFgQmjHnIrzXcUD1P9l82fCVmF5jhFWi3JQvq\nAAegJLQcW4NQ5ORv6Vr1kQSPj2EsgnDyhrYJ6zjVJNKERo0L4809oXhvFZLxsYY+\nRnNolI9BW54jWRY17es0/tUXvssGt0jIz/34WBLwKSlcfx40/jGZH0XM1mvUOZHP\nQKf7EGs1AgMBAAECggEACFRNbuujv5Evyx/ZAZPVO4+x5G6C1MG7n985GC51pYxG\nbRoBN4qS/t4/RqiV3SZeIuZQS8qx5Id+E+57yWSJbXrCCmJILjQiOiwrSki3HJjK\nxkw68CcV5I0g7k+o0F6XBhwSQ0a6cwKSAE+si4z6B8tvk1ChRf4lyPqxMZcy2Q7r\nvbMOo8gdUYF1FC2LEWVEgY9E0kFvaqAp4LLCwkt9gKEsC4Kb/BFaWmKHTQFPwLIE\nFPcfcmDB+owPndH/kWGnP3k2GxA8wub7NriBhbkJSyHw6VjvPzOkJmrFRV+vELs9\nOZzE41eCjcvVGhbHdDB85bIfiW6qInC9B2/V2Wf+IQKBgQDzC2Y3gvS0pTN9GeKR\nPpUKswRkTeWWi7mmNOxo+sc9Phk2qSL5UaDGpj9+dOmT9pBgrhpqS0cH4t10ExyL\nv0/CAf9+4RRz7uT2XzN46n6NNZVPYoITjpu7SXxHcIw4XsR71To5WwgeTN+noff7\n7ry6Ooa40ReAPblFm0WQxNC6pQKBgQDU8S2o9qRe1vFNVSXBkX17XBMBHYuq4w3x\npEyGYBy1fi1A99itRT9DrFuK64+veU5DDPf0sQOIQ+0nAHU/3OwUf9me3IzXnCWv\nVun2Ww9O3+QLSYPJP6MxDr8LTLj+9IEdIbW3Ku/Oui8P9rJkr/9Ldhn6aIpkcaGQ\nVhSFLdzfmQKBgBMG7ho/8xmdSYiN5hyGL9uN2xu7o2cSQ6cZkzSyWs9e6IIt3RsX\nc7doHf/oe0V2MjmowqVDVh5T3d3fMK+wd8Jkk2ke1QPG/SAGmWvmDJW9oa4vqoPA\nRia24YV7CqOmDHbAG/+Q4JWUsEkifRSdbDTjwuBsfiFWWQ9b7IVoBUZtAoGAa+st\nisOwUjDQWY8gRLHRzbBl3+7WMlFPvEgkbQ6BcOHxekJshtIsqK+uVdu7YE78qTRb\nq+R+s9eisRvhOpz31LXt3jUj+soiE6OxtMejC5ni9aTBiyhqJmEjti73gGXGyzk9\nb4P4aWfbUnN7VpWDxZNzj8aXtycp3euDJGnDv0ECgYEAkx8DTljZZN8gSvutk/63\nKp+Rq6s7yNDSFnUF0hR3mz6JVzwftKWfGqXMnFU0B6F7X9MvOsfb05h+yDlv6Ehz\n3/DuFrKKNOIuuJqfJ6RA9lgnItA5FvVNLDJtxfFOof1DHjiKk5RjPVNItBFMJ4C0\n2GLcLta5wf70MgE3QNYLkyI=\n-----END PRIVATE KEY-----",
    registeredTools: [
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
    ],
    corsOrigins: []
  };
}

async function signDeepLinkResponse(privateKey: KeyLike, config: AppConfig) {
  return new SignJWT({
    "https://purl.imsglobal.org/spec/lti/claim/message_type": "LtiDeepLinkingResponse",
    "https://purl.imsglobal.org/spec/lti/claim/version": "1.3.0",
    "https://purl.imsglobal.org/spec/lti-dl/claim/content_items": [
      {
        type: "ltiResourceLink",
        title: "PACT Squad Challenges",
        url: "https://pact.example.test/launch/challenge",
        lineItem: {
          label: "PACT Squad Challenges",
          scoreMaximum: 100,
          resourceId: "pact-challenge-hub",
          tag: "challenge"
        }
      }
    ],
    data: JSON.stringify({ courseId: "pact", cohortId: "cohort-alpha" })
  })
    .setProtectedHeader({ alg: "RS256", kid: "pact-tool-key" })
    .setIssuer("pact-tool")
    .setSubject("pact-tool")
    .setAudience(`${config.appBaseUrl}/api/v1/lti/deep-linking/return`)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
}

async function signKeycloakToken(privateKey: KeyLike, config: AppConfig) {
  return new SignJWT({
    email: "admin@example.test",
    name: "Integration Admin",
    realm_access: { roles: ["lms_learner", "lms_admin"] },
    resource_access: { "cetu-lms-api": { roles: ["lms_admin"] } },
    department_id: "cyber-training"
  })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(config.keycloakIssuer)
    .setAudience(config.keycloakAudience)
    .setSubject("keycloak-admin-sub")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
}
