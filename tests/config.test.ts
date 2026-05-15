import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/config.js";

describe("config", () => {
  async function baseEnv() {
    const { exportPKCS8, generateKeyPair } = await import("jose");
    const { privateKey } = await generateKeyPair("RS256");
    return {
      NODE_ENV: "production",
      APP_BASE_URL: "https://lms-api.cetu.online",
      MONGO_URI: "mongodb://user:password@localhost:27017",
      KEYCLOAK_ISSUER: "https://keycloak.cetu.online/realms/cetu",
      KEYCLOAK_AUDIENCE: "cetu-lms-api",
      LTI_ISSUER: "https://lms-api.cetu.online",
      LTI_PLATFORM_KID: "test-platform-key",
      LTI_PLATFORM_PRIVATE_KEY_PEM: await exportPKCS8(privateKey),
      LTI_TOOLS_JSON: "[]"
    };
  }

  it("rejects PACT or Keycloak database names for LMS persistence", async () => {
    const env = await baseEnv();

    expect(() => loadConfig({ ...env, MONGO_DB_NAME: "PACT_V4" })).toThrow(/LMS MONGO_DB_NAME/);
    expect(() => loadConfig({ ...env, MONGO_DB_NAME: "keycloak" })).toThrow(/LMS MONGO_DB_NAME/);
    expect(loadConfig({ ...env, MONGO_DB_NAME: "LMS" }).mongoDbName).toBe("LMS");
  });

  it("requires Resend email settings when email delivery is enabled", async () => {
    const env = await baseEnv();

    expect(() => loadConfig({ ...env, MONGO_DB_NAME: "LMS", EMAIL_PROVIDER: "resend" })).toThrow(/RESEND_API_KEY/);
    expect(loadConfig({
      ...env,
      MONGO_DB_NAME: "LMS",
      EMAIL_PROVIDER: "resend",
      EMAIL_FROM: "no-reply@cetu.online",
      ACCESS_REQUEST_ADMIN_EMAIL: "admin@cetu.online",
      RESEND_API_KEY: "test-resend-key"
    }).emailProvider).toBe("resend");
  });
});
