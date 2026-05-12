import { exportPKCS8, generateKeyPair } from "jose";
import { describe, expect, it } from "vitest";
import type { AppConfig } from "../src/config/config.js";
import { PlatformKeyService } from "../src/lti/services/platformKeyService.js";

describe("PlatformKeyService", () => {
  it("publishes only public RSA key material in JWKS", async () => {
    const { privateKey } = await generateKeyPair("RS256");
    const service = new PlatformKeyService({
      ...baseConfig,
      ltiPlatformPrivateKeyPem: await exportPKCS8(privateKey)
    });

    const jwks = await service.jwks();

    expect(jwks.keys).toHaveLength(1);
    expect(jwks.keys[0]).toMatchObject({
      kty: "RSA",
      kid: "test-platform-key",
      alg: "RS256",
      use: "sig"
    });
    expect(jwks.keys[0]).toHaveProperty("n");
    expect(jwks.keys[0]).toHaveProperty("e");
    expect(jwks.keys[0]).not.toHaveProperty("d");
    expect(jwks.keys[0]).not.toHaveProperty("p");
    expect(jwks.keys[0]).not.toHaveProperty("q");
  });
});

const baseConfig: AppConfig = {
  env: "test",
  port: 0,
  appBaseUrl: "http://localhost:4000",
  ltiIssuer: "http://localhost:4000",
  mongoUri: "mongodb://127.0.0.1:27017",
  mongoDbName: "CETU_TEST",
  mongoCollectionPrefix: "test_",
  keycloakIssuer: "http://keycloak.test/realms/cetu",
  keycloakAudience: "cetu-lms-api",
  keycloakJwksUri: "http://keycloak.test/realms/cetu/protocol/openid-connect/certs",
  keycloakAdminBaseUrl: "http://keycloak.test",
  keycloakAdminRealm: "cetu",
  keycloakAdminTokenRealm: "cetu",
  keycloakWebhookSecret: "test-webhook-secret-with-enough-length",
  ltiPlatformKid: "test-platform-key",
  ltiPlatformPrivateKeyPem: "",
  registeredTools: [],
  corsOrigins: []
};
