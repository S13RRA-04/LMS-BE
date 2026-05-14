import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/config.js";

describe("config", () => {
  it("rejects PACT or Keycloak database names for LMS persistence", async () => {
    const { exportPKCS8, generateKeyPair } = await import("jose");
    const { privateKey } = await generateKeyPair("RS256");
    const baseEnv = {
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

    expect(() => loadConfig({ ...baseEnv, MONGO_DB_NAME: "PACT_V4" })).toThrow(/LMS MONGO_DB_NAME/);
    expect(() => loadConfig({ ...baseEnv, MONGO_DB_NAME: "keycloak" })).toThrow(/LMS MONGO_DB_NAME/);
    expect(loadConfig({ ...baseEnv, MONGO_DB_NAME: "LMS" }).mongoDbName).toBe("LMS");
  });
});
