import http from "node:http";
import { exportJWK, generateKeyPair, SignJWT, type KeyLike } from "jose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import worker from "../src/worker.js";
import { loadConfig, type AppConfig } from "../src/config/config.js";
import { closeMongoClient, collectionNames, ensureMongoCollections, getMongoDb } from "../src/db/mongo.js";

describe("LMS Worker API integration", () => {
  let mongo: MongoMemoryServer;
  let jwksServer: http.Server;
  let jwksUrl: string;
  let privateKey: KeyLike;
  let toolPrivateKey: KeyLike;
  let toolPublicJwk: Record<string, unknown>;
  let env: Record<string, string>;
  let config: AppConfig;

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    const keys = await generateKeyPair("RS256");
    privateKey = keys.privateKey;
    const publicJwk = await exportJWK(keys.publicKey);
    const toolKeys = await generateKeyPair("RS256");
    toolPrivateKey = toolKeys.privateKey;
    toolPublicJwk = (await exportJWK(toolKeys.publicKey)) as Record<string, unknown>;
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

    env = testEnv(mongo.getUri(), jwksUrl, toolPublicJwk);
    config = loadConfig(env);
    await ensureMongoCollections(config);
  });

  afterAll(async () => {
    await closeMongoClient();
    await mongo.stop();
    await new Promise<void>((resolve, reject) => jwksServer.close((error) => (error ? reject(error) : resolve())));
  });

  it("refreshes an approved internal user from Keycloak subject and writes audit log for admin course creation", async () => {
    const token = await signKeycloakToken(privateKey, config);
    const db = await getMongoDb(config);
    const names = collectionNames(config);
    await db.collection(names.users).replaceOne(
      { keycloakSub: "keycloak-admin-sub" },
      {
        id: "approved-admin",
        keycloakSub: "keycloak-admin-sub",
        username: "admin",
        email: "old-admin@example.test",
        name: "Old Admin",
        role: "admin",
        roles: ["admin"],
        permissions: ["lms_admin"],
        enabled: true,
        createdAt: "2026-05-14T00:00:00.000Z",
        updatedAt: "2026-05-14T00:00:00.000Z"
      },
      { upsert: true }
    );

    const response = await api("POST", "/api/v1/lms/admin/courses", {
      headers: {
        authorization: `Bearer ${token}`,
        "x-request-id": "integration-request"
      },
      body: {
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
      }
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ id: "malware-analysis" });

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

  it("rejects valid Keycloak users that have not been approved into the LMS", async () => {
    const token = await signKeycloakToken(privateKey, config, { sub: "unapproved-user-sub", email: "unapproved@example.test" });

    const response = await api("GET", "/api/v1/lms/learner/dashboard", {
      headers: { authorization: `Bearer ${token}` }
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "USER_NOT_APPROVED" } });
  });

  it("allows enrolled learners to launch an LTI course with cohort context", async () => {
    await api("POST", "/api/v1/lms/admin/courses", {
      headers: devAdminHeaders(),
      body: {
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
      }
    }).then((response) => expect(response.status).toBe(201));

    await api("POST", "/api/v1/lms/admin/cohorts", {
      headers: devAdminHeaders(),
      body: {
        id: "cohort-alpha",
        name: "Alpha Cohort",
        courseIds: ["pact"],
        status: "active"
      }
    }).then((response) => expect(response.status).toBe(201));

    await api("POST", "/api/v1/lms/admin/enrollments", {
      headers: devAdminHeaders(),
      body: {
        userId: "learner-1",
        courseId: "pact",
        cohortId: "cohort-alpha",
        status: "in_progress",
        progressPercent: 0
      }
    }).then((response) => expect(response.status).toBe(201));

    const launch = await api("POST", "/api/v1/lms/courses/pact/launch", {
      headers: {
        "x-dev-user-id": "learner-1",
        "x-dev-user-roles": "learner",
        "x-dev-user-email": "learner@example.test",
        "x-dev-user-name": "Learner One"
      }
    });

    expect(launch.status).toBe(200);
    expect(launch.headers.get("content-type")).toContain("text/html");
    const text = await launch.text();
    expect(text).toContain("id_token");
    expect(text).toContain("https://pact.example.test/lti/launch");
    const claims = decodeJwtPayload(extractHiddenInput(text, "id_token"));
    expect(claims).toMatchObject({
      sub: "learner-1",
      aud: "pact-tool",
      iss: "http://localhost:4000",
      "https://purl.imsglobal.org/spec/lti/claim/message_type": "LtiResourceLinkRequest",
      "https://purl.imsglobal.org/spec/lti/claim/version": "1.3.0",
      "https://purl.imsglobal.org/spec/lti/claim/deployment_id": "pact-course-deployment",
      "https://purl.imsglobal.org/spec/lti/claim/target_link_uri": "https://pact.example.test/lti/launch",
      "https://purl.imsglobal.org/spec/lti/claim/resource_link": { id: "pact", title: "PACT" },
      "https://purl.imsglobal.org/spec/lti/claim/context": { id: "cohort-alpha", title: "PACT" },
      "https://purl.imsglobal.org/spec/lti/claim/custom": {
        course_id: "pact",
        cohort_id: "cohort-alpha"
      }
    });
    expect(JSON.stringify(claims).toLowerCase()).not.toContain("squad");
  });

  it("allows admins to launch an LTI course without enrollment", async () => {
    await api("POST", "/api/v1/lms/admin/courses", {
      headers: devAdminHeaders(),
      body: {
        id: "pact-admin-open",
        slug: "pact-admin-open",
        title: "PACT Admin Open",
        description: "Practical cyber training course and tool launch.",
        type: "lti_tool",
        status: "published",
        category: "Cyber Operations",
        departmentIds: ["cyber-training"],
        allowSelfEnrollment: false,
        estimatedMinutes: 120,
        ltiToolClientId: "pact-tool"
      }
    }).then((response) => expect(response.status).toBe(201));

    await api("POST", "/api/v1/lms/courses/pact-admin-open/launch", {
      headers: { "x-dev-user-id": "learner-without-enrollment", "x-dev-user-roles": "learner" }
    }).then((response) => expect(response.status).toBe(403));

    const launch = await api("POST", "/api/v1/lms/courses/pact-admin-open/launch", {
      headers: {
        "x-dev-user-id": "admin-without-enrollment",
        "x-dev-user-roles": "admin",
        "x-dev-user-email": "admin-open@example.test",
        "x-dev-user-name": "Admin Open"
      }
    });

    expect(launch.status).toBe(200);
    const launchHtml = await launch.text();
    expect(launchHtml).toContain("https://pact.example.test/lti/launch");
    const claims = decodeJwtPayload(extractHiddenInput(launchHtml, "id_token"));
    expect(claims).toMatchObject({
      sub: "admin-without-enrollment",
      aud: "pact-tool",
      "https://purl.imsglobal.org/spec/lti/claim/message_type": "LtiResourceLinkRequest",
      "https://purl.imsglobal.org/spec/lti/claim/version": "1.3.0",
      "https://purl.imsglobal.org/spec/lti/claim/target_link_uri": "https://pact.example.test/lti/launch",
      "https://purl.imsglobal.org/spec/lti/claim/resource_link": { id: "pact-admin-open", title: "PACT Admin Open" },
      "https://purl.imsglobal.org/spec/lti/claim/context": { id: "pact-admin-open", title: "PACT Admin Open" }
    });
    expect(claims["https://purl.imsglobal.org/spec/lti/claim/roles"]).toEqual([
      "http://purl.imsglobal.org/vocab/lis/v2/membership#Administrator"
    ]);
  });

  it("allows admins to initiate PACT Deep Linking for an LTI course", async () => {
    await api("POST", "/api/v1/lms/admin/courses", {
      headers: devAdminHeaders(),
      body: {
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
      }
    }).then((response) => expect(response.status).toBe(201));

    const response = await api("POST", "/api/v1/lms/admin/courses/pact-deep-link/deep-link", {
      headers: devAdminHeaders(),
      body: { cohortId: "cohort-alpha" }
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    const text = await response.text();
    expect(text).toContain("id_token");
    expect(text).toContain("https://pact.example.test/lti/deep-link");
    const claims = decodeJwtPayload(extractHiddenInput(text, "id_token"));
    expect(claims).toMatchObject({
      aud: "pact-tool",
      "https://purl.imsglobal.org/spec/lti/claim/message_type": "LtiDeepLinkingRequest",
      "https://purl.imsglobal.org/spec/lti/claim/version": "1.3.0",
      "https://purl.imsglobal.org/spec/lti/claim/deployment_id": "pact-course-deployment",
      "https://purl.imsglobal.org/spec/lti/claim/target_link_uri": "https://pact.example.test/lti/deep-link",
      "https://purl.imsglobal.org/spec/lti/claim/context": { id: "cohort-alpha", title: "PACT Deep Link" },
      "https://purl.imsglobal.org/spec/lti/claim/custom": {
        course_id: "pact-deep-link",
        cohort_id: "cohort-alpha"
      }
    });
    expect(claims["https://purl.imsglobal.org/spec/lti-dl/claim/deep_linking_settings"]).toMatchObject({
      deep_link_return_url: "http://localhost:4000/api/v1/lti/deep-linking/return",
      accept_types: ["ltiResourceLink"]
    });

    await api("POST", "/api/v1/lms/admin/courses/pact-deep-link/deep-link", {
      headers: { "x-dev-user-id": "learner-1", "x-dev-user-roles": "learner" },
      body: { cohortId: "cohort-alpha" }
    }).then((learnerResponse) => expect(learnerResponse.status).toBe(403));
  });

  it("allows admins to launch a PACT AGS context refresh shortcut", async () => {
    await api("POST", "/api/v1/lms/admin/courses", {
      headers: devAdminHeaders(),
      body: {
        id: "pact-ags-refresh",
        slug: "pact-ags-refresh",
        title: "PACT AGS Refresh",
        description: "Practical cyber training course and tool launch.",
        type: "lti_tool",
        status: "published",
        category: "Cyber Operations",
        departmentIds: ["cyber-training"],
        allowSelfEnrollment: false,
        estimatedMinutes: 120,
        ltiToolClientId: "pact-tool"
      }
    }).then((response) => expect(response.status).toBe(201));

    await api("POST", "/api/v1/lms/admin/cohorts", {
      headers: devAdminHeaders(),
      body: {
        id: "cohort-ags-refresh",
        name: "AGS Refresh Cohort",
        courseIds: ["pact-ags-refresh"],
        status: "active"
      }
    }).then((response) => expect(response.status).toBe(201));

    const response = await api("POST", "/api/v1/lms/admin/courses/pact-ags-refresh/ags-context-refresh", {
      headers: devAdminHeaders(),
      body: { cohortId: "cohort-ags-refresh" }
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    const text = await response.text();
    expect(text).toContain("id_token");
    expect(text).toContain("https://pact.example.test/lti/launch");
    const claims = decodeJwtPayload(extractHiddenInput(text, "id_token"));
    expect(claims).toMatchObject({
      aud: "pact-tool",
      "https://purl.imsglobal.org/spec/lti/claim/message_type": "LtiResourceLinkRequest",
      "https://purl.imsglobal.org/spec/lti/claim/resource_link": { id: "pact-ags-refresh:ags-context-refresh", title: "PACT AGS Refresh AGS Context Refresh" },
      "https://purl.imsglobal.org/spec/lti/claim/context": { id: "cohort-ags-refresh", title: "PACT AGS Refresh" },
      "https://purl.imsglobal.org/spec/lti/claim/custom": {
        course_id: "pact-ags-refresh",
        cohort_id: "cohort-ags-refresh",
        ags_context_refresh: "true"
      }
    });
    expect(claims["https://purl.imsglobal.org/spec/lti-ags/claim/endpoint"].scope).toContain(
      "https://purl.imsglobal.org/spec/lti-ags/scope/score"
    );

    await api("POST", "/api/v1/lms/admin/courses/pact-ags-refresh/ags-context-refresh", {
      headers: { "x-dev-user-id": "learner-1", "x-dev-user-roles": "learner" },
      body: { cohortId: "cohort-alpha" }
    }).then((learnerResponse) => expect(learnerResponse.status).toBe(403));

    await api("POST", "/api/v1/lms/admin/courses/pact-ags-refresh/ags-context-refresh", {
      headers: devAdminHeaders(),
      body: { cohortId: "missing-cohort" }
    }).then((invalidCohortResponse) => expect(invalidCohortResponse.status).toBe(400));
  });

  it("allows admins to manage cohorts for courses", async () => {
    await api("POST", "/api/v1/lms/admin/courses", {
      headers: devAdminHeaders(),
      body: {
        id: "cohort-course",
        slug: "cohort-course",
        title: "Cohort Course",
        description: "Course with managed cohorts.",
        type: "online",
        status: "published",
        category: "Cyber Operations",
        departmentIds: ["cyber-training"],
        allowSelfEnrollment: false
      }
    }).then((response) => expect(response.status).toBe(201));

    const created = await api("POST", "/api/v1/lms/admin/cohorts", {
      headers: devAdminHeaders(),
      body: {
        id: "cohort-blue",
        name: "Blue Team Cohort",
        description: "Blue team learners.",
        courseIds: ["cohort-course"],
        status: "active"
      }
    });

    expect(created.status).toBe(201);
    await expect(created.json()).resolves.toMatchObject({ id: "cohort-blue", courseIds: ["cohort-course"] });

    const updated = await api("PATCH", "/api/v1/lms/admin/cohorts/cohort-blue", {
      headers: devAdminHeaders(),
      body: { status: "archived" }
    });

    expect(updated.status).toBe(200);
    await expect(updated.json()).resolves.toMatchObject({ id: "cohort-blue", status: "archived" });

    const learnerResponse = await api("GET", "/api/v1/lms/admin/cohorts", {
      headers: { "x-dev-user-id": "learner-1", "x-dev-user-roles": "learner" }
    });
    expect(learnerResponse.status).toBe(403);
  });

  it("rejects enrollment into a cohort that is not active for the course", async () => {
    await api("POST", "/api/v1/lms/admin/courses", {
      headers: devAdminHeaders(),
      body: {
        id: "invalid-cohort-course",
        slug: "invalid-cohort-course",
        title: "Invalid Cohort Course",
        description: "Course with archived cohort.",
        type: "online",
        status: "published",
        category: "Cyber Operations",
        departmentIds: ["cyber-training"],
        allowSelfEnrollment: false
      }
    }).then((courseResponse) => expect(courseResponse.status).toBe(201));

    await api("POST", "/api/v1/lms/admin/cohorts", {
      headers: devAdminHeaders(),
      body: {
        id: "cohort-archived",
        name: "Archived Cohort",
        courseIds: ["invalid-cohort-course"],
        status: "archived"
      }
    }).then((cohortResponse) => expect(cohortResponse.status).toBe(201));

    const response = await api("POST", "/api/v1/lms/admin/enrollments", {
      headers: devAdminHeaders(),
      body: {
        userId: "learner-invalid-cohort",
        courseId: "invalid-cohort-course",
        cohortId: "cohort-archived",
        status: "not_started",
        progressPercent: 0
      }
    });

    expect(response.status).toBe(400);
  });

  it("persists accepted PACT Deep Linking items as LMS content and line items", async () => {
    const jwt = await signDeepLinkResponse(toolPrivateKey, config);

    const accepted = await api("POST", "/api/v1/lti/deep-linking/return", {
      form: { JWT: jwt }
    });

    expect(accepted.status).toBe(200);
    await expect(accepted.json()).resolves.toMatchObject({
      count: 3,
      accepted: [
        {
          toolClientId: "pact-tool",
          title: "PACT Modules",
          courseId: "pact"
        },
        {
          toolClientId: "pact-tool",
          title: "PACT Challenges",
          courseId: "pact",
          cohortId: "cohort-alpha"
        },
        {
          toolClientId: "pact-tool",
          title: "PACT Workshops",
          courseId: "pact",
          cohortId: "cohort-alpha"
        }
      ]
    });

    const deepLinks = await api("GET", "/api/v1/lms/admin/deep-links", {
      headers: devAdminHeaders()
    });

    expect(deepLinks.status).toBe(200);
    const body = await deepLinks.json() as {
      contentItems: Array<{ title: string; cohortId?: string | null }>;
      lineItems: Array<{ label: string; scoreMaximum: number; resourceId: string; tag: string; cohortId?: string | null }>;
    };
    expect(body.contentItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: "PACT Modules", cohortId: null }),
      expect.objectContaining({ title: "PACT Challenges", cohortId: "cohort-alpha" }),
      expect.objectContaining({ title: "PACT Workshops", cohortId: "cohort-alpha" })
    ]));
    expect(body.lineItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "PACT Modules", resourceId: "pact-module-hub", tag: "module", cohortId: null }),
      expect.objectContaining({ label: "PACT Challenges", scoreMaximum: 100, resourceId: "pact-challenge-hub", tag: "challenge", cohortId: "cohort-alpha" }),
      expect.objectContaining({ label: "PACT Workshops", scoreMaximum: 100, resourceId: "pact-workshop-hub", tag: "workshop", cohortId: "cohort-alpha" })
    ]));
    expect(JSON.stringify(body).toLowerCase()).not.toContain("squad");
  });

  it("rejects unauthenticated Keycloak user sync events", async () => {
    const response = await api("POST", "/api/v1/keycloak/events", {
      body: { operationType: "UPDATE", resourcePath: "users/keycloak-user-1" }
    });

    expect(response.status).toBe(401);
  });

  async function api(method: string, path: string, options: { headers?: Record<string, string>; body?: unknown; form?: Record<string, string> } = {}) {
    const headers = new Headers(options.headers);
    let body: BodyInit | undefined;

    if (options.form) {
      headers.set("content-type", "application/x-www-form-urlencoded");
      body = new URLSearchParams(options.form);
    } else if (options.body !== undefined) {
      headers.set("content-type", "application/json");
      body = JSON.stringify(options.body);
    }

    return worker.fetch(new Request(`https://lms.example.test${path}`, { method, headers, body }), env);
  }
});

function devAdminHeaders() {
  return { "x-dev-user-id": "admin-user", "x-dev-user-roles": "admin" };
}

function testEnv(mongoUri: string, jwksUrl: string, toolPublicJwk: Record<string, unknown>): Record<string, string> {
  return {
    NODE_ENV: "test",
    PORT: "1",
    APP_BASE_URL: "http://localhost:4000",
    MONGO_URI: mongoUri,
    MONGO_DB_NAME: "CETU",
    MONGO_COLLECTION_PREFIX: "staging_test_",
    KEYCLOAK_ISSUER: "http://keycloak.test/realms/cetu",
    KEYCLOAK_AUDIENCE: "cetu-lms-api",
    KEYCLOAK_JWKS_URI: jwksUrl,
    KEYCLOAK_ADMIN_BASE_URL: "http://keycloak.test",
    KEYCLOAK_ADMIN_REALM: "cetu",
    KEYCLOAK_ADMIN_TOKEN_REALM: "cetu",
    KEYCLOAK_WEBHOOK_SECRET: "test-webhook-secret-with-enough-length",
    LTI_ISSUER: "http://localhost:4000",
    LTI_PLATFORM_KID: "test-platform-key",
    LTI_PLATFORM_PRIVATE_KEY_PEM:
      "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDJo+4HVmM0MdQc\nuywa+88cPJUgftuMdbsXgoahtGu8gEbQu8RXObej+Vo1mnFmY5p0PCYb9zKusJq5\nLrrPfmzgcaIb85xrntCgu+eah1IV6gOLLYgQy2kbjiBplxohF3q8klMgG9Xr5XEG\nR6rlfAaP7cNI9e6fryUz2RXxAoVyFgQmjHnIrzXcUD1P9l82fCVmF5jhFWi3JQvq\nAAegJLQcW4NQ5ORv6Vr1kQSPj2EsgnDyhrYJ6zjVJNKERo0L4809oXhvFZLxsYY+\nRnNolI9BW54jWRY17es0/tUXvssGt0jIz/34WBLwKSlcfx40/jGZH0XM1mvUOZHP\nQKf7EGs1AgMBAAECggEACFRNbuujv5Evyx/ZAZPVO4+x5G6C1MG7n985GC51pYxG\nbRoBN4qS/t4/RqiV3SZeIuZQS8qx5Id+E+57yWSJbXrCCmJILjQiOiwrSki3HJjK\nxkw68CcV5I0g7k+o0F6XBhwSQ0a6cwKSAE+si4z6B8tvk1ChRf4lyPqxMZcy2Q7r\nvbMOo8gdUYF1FC2LEWVEgY9E0kFvaqAp4LLCwkt9gKEsC4Kb/BFaWmKHTQFPwLIE\nFPcfcmDB+owPndH/kWGnP3k2GxA8wub7NriBhbkJSyHw6VjvPzOkJmrFRV+vELs9\nOZzE41eCjcvVGhbHdDB85bIfiW6qInC9B2/V2Wf+IQKBgQDzC2Y3gvS0pTN9GeKR\nPpUKswRkTeWWi7mmNOxo+sc9Phk2qSL5UaDGpj9+dOmT9pBgrhpqS0cH4t10ExyL\nv0/CAf9+4RRz7uT2XzN46n6NNZVPYoITjpu7SXxHcIw4XsR71To5WwgeTN+noff7\n7ry6Ooa40ReAPblFm0WQxNC6pQKBgQDU8S2o9qRe1vFNVSXBkX17XBMBHYuq4w3x\npEyGYBy1fi1A99itRT9DrFuK64+veU5DDPf0sQOIQ+0nAHU/3OwUf9me3IzXnCWv\nVun2Ww9O3+QLSYPJP6MxDr8LTLj+9IEdIbW3Ku/Oui8P9rJkr/9Ldhn6aIpkcaGQ\nVhSFLdzfmQKBgBMG7ho/8xmdSYiN5hyGL9uN2xu7o2cSQ6cZkzSyWs9e6IIt3RsX\nc7doHf/oe0V2MjmowqVDVh5T3d3fMK+wd8Jkk2ke1QPG/SAGmWvmDJW9oa4vqoPA\nRia24YV7CqOmDHbAG/+Q4JWUsEkifRSdbDTjwuBsfiFWWQ9b7IVoBUZtAoGAa+st\nisOwUjDQWY8gRLHRzbBl3+7WMlFPvEgkbQ6BcOHxekJshtIsqK+uVdu7YE78qTRb\nq+R+s9eisRvhOpz31LXt3jUj+soiE6OxtMejC5ni9aTBiyhqJmEjti73gGXGyzk9\nb4P4aWfbUnN7VpWDxZNzj8aXtycp3euDJGnDv0ECgYEAkx8DTljZZN8gSvutk/63\nKp+Rq6s7yNDSFnUF0hR3mz6JVzwftKWfGqXMnFU0B6F7X9MvOsfb05h+yDlv6Ehz\n3/DuFrKKNOIuuJqfJ6RA9lgnItA5FvVNLDJtxfFOof1DHjiKk5RjPVNItBFMJ4C0\n2GLcLta5wf70MgE3QNYLkyI=\n-----END PRIVATE KEY-----",
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
    CORS_ORIGINS: ""
  };
}

async function signDeepLinkResponse(privateKey: KeyLike, config: AppConfig) {
  return new SignJWT({
    "https://purl.imsglobal.org/spec/lti/claim/message_type": "LtiDeepLinkingResponse",
    "https://purl.imsglobal.org/spec/lti/claim/version": "1.3.0",
    "https://purl.imsglobal.org/spec/lti-dl/claim/content_items": [
      {
        type: "ltiResourceLink",
        title: "PACT Modules",
        url: "https://pact.example.test/launch/module",
        lineItem: {
          label: "PACT Modules",
          scoreMaximum: 100,
          resourceId: "pact-module-hub",
          tag: "module"
        }
      },
      {
        type: "ltiResourceLink",
        title: "PACT Challenges",
        url: "https://pact.example.test/launch/challenge",
        lineItem: {
          label: "PACT Challenges",
          scoreMaximum: 100,
          resourceId: "pact-challenge-hub",
          tag: "challenge"
        }
      },
      {
        type: "ltiResourceLink",
        title: "PACT Workshops",
        url: "https://pact.example.test/launch/workshop",
        lineItem: {
          label: "PACT Workshops",
          scoreMaximum: 100,
          resourceId: "pact-workshop-hub",
          tag: "workshop"
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

async function signKeycloakToken(privateKey: KeyLike, config: AppConfig, overrides: { sub?: string; email?: string } = {}) {
  return new SignJWT({
    email: overrides.email ?? "admin@example.test",
    name: "Integration Admin",
    realm_access: { roles: ["lms_learner", "lms_admin"] },
    resource_access: { "cetu-lms-api": { roles: ["lms_admin"] } },
    department_id: "cyber-training"
  })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(config.keycloakIssuer)
    .setAudience(config.keycloakAudience)
    .setSubject(overrides.sub ?? "keycloak-admin-sub")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
}

function extractHiddenInput(html: string, name: string) {
  const match = html.match(new RegExp(`name="${name}" value="([^"]+)"`));
  if (!match?.[1]) throw new Error(`Hidden input ${name} was not found`);
  return match[1]
    .replace(/&quot;/g, "\"")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function decodeJwtPayload(token: string) {
  const [, payload] = token.split(".");
  if (!payload) throw new Error("JWT payload was not found");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
}
