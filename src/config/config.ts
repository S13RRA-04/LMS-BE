import { z } from "zod";
import type { JWK } from "jose";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  APP_BASE_URL: z.string().url(),
  MONGO_URI: z.string().min(1),
  MONGO_DB_NAME: z.string().min(1).default("CETU"),
  MONGO_COLLECTION_PREFIX: z.string().optional(),
  MONGO_TLS_CERT_KEY_FILE: z.string().optional(),
  KEYCLOAK_ISSUER: z.string().url(),
  KEYCLOAK_AUDIENCE: z.string().min(1),
  KEYCLOAK_JWKS_URI: z.string().url().optional(),
  KEYCLOAK_ADMIN_BASE_URL: z.string().url().optional(),
  KEYCLOAK_ADMIN_REALM: z.string().min(1).optional(),
  KEYCLOAK_ADMIN_TOKEN_REALM: z.string().min(1).optional(),
  KEYCLOAK_ADMIN_CLIENT_ID: z.string().min(1).optional(),
  KEYCLOAK_ADMIN_CLIENT_SECRET: z.string().min(1).optional(),
  KEYCLOAK_ADMIN_USERNAME: z.string().min(1).optional(),
  KEYCLOAK_ADMIN_PASSWORD: z.string().min(1).optional(),
  KEYCLOAK_WEBHOOK_SECRET: z.string().min(24).optional(),
  LTI_ISSUER: z.string().url(),
  LTI_PLATFORM_KID: z.string().min(1),
  LTI_PLATFORM_PRIVATE_KEY_PEM: z.string().min(1),
  LTI_TOOLS_JSON: z.string().default("[]"),
  CORS_ORIGINS: z.string().default("")
});

const registeredToolSchema = z.object({
  clientId: z.string().min(1),
  name: z.string().min(1),
  deploymentIds: z.array(z.string().min(1)).min(1),
  redirectUris: z.array(z.string().url()).min(1),
  deepLinkRedirectUris: z.array(z.string().url()).default([]),
  targetLinkUri: z.string().url(),
  publicJwks: z
    .object({
      keys: z.array(z.custom<JWK>((value) => typeof value === "object" && value !== null && "kty" in value))
    })
    .optional(),
  scopes: z.array(z.string()).default([])
});

export type RegisteredToolConfig = z.infer<typeof registeredToolSchema>;

export type AppConfig = {
  env: "development" | "test" | "production";
  port: number;
  appBaseUrl: string;
  ltiIssuer: string;
  mongoUri: string;
  mongoDbName: string;
  mongoCollectionPrefix: string;
  mongoTlsCertKeyFile?: string;
  keycloakIssuer: string;
  keycloakAudience: string;
  keycloakJwksUri: string;
  keycloakAdminBaseUrl?: string;
  keycloakAdminRealm: string;
  keycloakAdminTokenRealm: string;
  keycloakAdminClientId?: string;
  keycloakAdminClientSecret?: string;
  keycloakAdminUsername?: string;
  keycloakAdminPassword?: string;
  keycloakWebhookSecret?: string;
  ltiPlatformKid: string;
  ltiPlatformPrivateKeyPem: string;
  registeredTools: RegisteredToolConfig[];
  corsOrigins: string[];
};

export function loadConfig(source: NodeJS.ProcessEnv): AppConfig {
  const parsed = envSchema.parse(source);
  const tools = z.array(registeredToolSchema).parse(JSON.parse(parsed.LTI_TOOLS_JSON));
  const issuer = parsed.KEYCLOAK_ISSUER.replace(/\/$/, "");
  const issuerUrl = new URL(issuer);
  const issuerRealm = issuerUrl.pathname.split("/").filter(Boolean).at(-1) ?? "cetu";

  return {
    env: parsed.NODE_ENV,
    port: parsed.PORT,
    appBaseUrl: parsed.APP_BASE_URL.replace(/\/$/, ""),
    mongoUri: parsed.MONGO_URI,
    mongoDbName: parsed.MONGO_DB_NAME,
    mongoCollectionPrefix: parsed.MONGO_COLLECTION_PREFIX ?? (parsed.NODE_ENV === "production" ? "" : "staging_"),
    mongoTlsCertKeyFile: parsed.MONGO_TLS_CERT_KEY_FILE,
    keycloakIssuer: issuer,
    keycloakAudience: parsed.KEYCLOAK_AUDIENCE,
    keycloakJwksUri:
      parsed.KEYCLOAK_JWKS_URI ??
      `${parsed.KEYCLOAK_ISSUER.replace(/\/$/, "")}/protocol/openid-connect/certs`,
    keycloakAdminBaseUrl: parsed.KEYCLOAK_ADMIN_BASE_URL?.replace(/\/$/, "") ?? issuerUrl.origin,
    keycloakAdminRealm: parsed.KEYCLOAK_ADMIN_REALM ?? issuerRealm,
    keycloakAdminTokenRealm: parsed.KEYCLOAK_ADMIN_TOKEN_REALM ?? parsed.KEYCLOAK_ADMIN_REALM ?? issuerRealm,
    keycloakAdminClientId: parsed.KEYCLOAK_ADMIN_CLIENT_ID,
    keycloakAdminClientSecret: parsed.KEYCLOAK_ADMIN_CLIENT_SECRET,
    keycloakAdminUsername: parsed.KEYCLOAK_ADMIN_USERNAME,
    keycloakAdminPassword: parsed.KEYCLOAK_ADMIN_PASSWORD,
    keycloakWebhookSecret: parsed.KEYCLOAK_WEBHOOK_SECRET,
    ltiIssuer: parsed.LTI_ISSUER.replace(/\/$/, ""),
    ltiPlatformKid: parsed.LTI_PLATFORM_KID,
    ltiPlatformPrivateKeyPem: parsed.LTI_PLATFORM_PRIVATE_KEY_PEM.replace(/\\n/g, "\n"),
    registeredTools: tools,
    corsOrigins: parsed.CORS_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean)
  };
}
