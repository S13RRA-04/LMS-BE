import { z } from "zod";
import type { JWK } from "jose";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  APP_BASE_URL: z.string().url(),
  MONGO_URI: z.string().min(1),
  MONGO_USERNAME: z.string().min(1).optional(),
  MONGO_PASSWORD: z.string().min(1).optional(),
  MONGO_DB_NAME: z.string().min(1).default("LMS"),
  MONGO_COLLECTION_PREFIX: z.string().optional(),
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
  EMAIL_PROVIDER: z.enum(["noop", "resend"]).default("noop"),
  EMAIL_FROM: z.string().email().optional(),
  ACCESS_REQUEST_ADMIN_EMAIL: z.string().email().optional(),
  RESEND_API_KEY: z.string().min(1).optional(),
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
  emailProvider: "noop" | "resend";
  emailFrom?: string;
  accessRequestAdminEmail?: string;
  resendApiKey?: string;
  ltiPlatformKid: string;
  ltiPlatformPrivateKeyPem: string;
  registeredTools: RegisteredToolConfig[];
  corsOrigins: string[];
};

export function loadConfig(source: NodeJS.ProcessEnv): AppConfig {
  const parsed = envSchema.parse(source);
  const mongoUri = buildMongoUri(parsed.MONGO_URI, parsed.MONGO_USERNAME, parsed.MONGO_PASSWORD);
  assertWorkerCompatibleMongoUri(mongoUri, parsed.NODE_ENV);
  assertLmsMongoDatabaseName(parsed.MONGO_DB_NAME);
  const tools = z.array(registeredToolSchema).parse(JSON.parse(parsed.LTI_TOOLS_JSON));
  const issuer = parsed.KEYCLOAK_ISSUER.replace(/\/$/, "");
  const issuerUrl = new URL(issuer);
  const issuerRealm = issuerUrl.pathname.split("/").filter(Boolean).at(-1) ?? "cetu";
  assertEmailConfig(parsed);

  return {
    env: parsed.NODE_ENV,
    port: parsed.PORT,
    appBaseUrl: parsed.APP_BASE_URL.replace(/\/$/, ""),
    mongoUri,
    mongoDbName: parsed.MONGO_DB_NAME,
    mongoCollectionPrefix: parsed.MONGO_COLLECTION_PREFIX ?? (parsed.NODE_ENV === "production" ? "" : "staging_"),
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
    emailProvider: parsed.EMAIL_PROVIDER,
    emailFrom: parsed.EMAIL_FROM,
    accessRequestAdminEmail: parsed.ACCESS_REQUEST_ADMIN_EMAIL,
    resendApiKey: parsed.RESEND_API_KEY,
    ltiIssuer: parsed.LTI_ISSUER.replace(/\/$/, ""),
    ltiPlatformKid: parsed.LTI_PLATFORM_KID,
    ltiPlatformPrivateKeyPem: parsed.LTI_PLATFORM_PRIVATE_KEY_PEM.replace(/\\n/g, "\n"),
    registeredTools: tools,
    corsOrigins: parsed.CORS_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean)
  };
}

function assertEmailConfig(parsed: z.infer<typeof envSchema>) {
  if (parsed.EMAIL_PROVIDER !== "resend") {
    return;
  }

  const missing = [
    ["RESEND_API_KEY", parsed.RESEND_API_KEY],
    ["EMAIL_FROM", parsed.EMAIL_FROM],
    ["ACCESS_REQUEST_ADMIN_EMAIL", parsed.ACCESS_REQUEST_ADMIN_EMAIL]
  ].filter(([, value]) => !value).map(([name]) => name);

  if (missing.length) {
    throw new Error(`EMAIL_PROVIDER=resend requires ${missing.join(", ")}.`);
  }
}

function buildMongoUri(mongoUri: string, username?: string, password?: string) {
  if (!username && !password) {
    return mongoUri;
  }

  if (!username || !password) {
    throw new Error("MONGO_USERNAME and MONGO_PASSWORD must both be set when either one is provided.");
  }

  return mongoUri.replace(
    /^(mongodb(?:\+srv)?:\/\/)(?:[^@/?]+@)?(.+)$/i,
    (_match, prefix: string, rest: string) => `${prefix}${encodeURIComponent(username)}:${encodeURIComponent(password)}@${rest}`
  );
}

function assertWorkerCompatibleMongoUri(mongoUri: string, nodeEnv: "development" | "test" | "production") {
  if (/authMechanism=MONGODB-X509|authMechanism=%24external|authSource=%24external/i.test(mongoUri)) {
    throw new Error("MONGO_URI must use MongoDB database-user credentials for Cloudflare Workers; X.509 certificate-file auth is not supported.");
  }

  if (nodeEnv === "production" && !/^mongodb(\+srv)?:\/\/[^:/@]+:[^@]+@/i.test(mongoUri)) {
    throw new Error("MONGO_URI must include MongoDB database-user credentials.");
  }
}

function assertLmsMongoDatabaseName(databaseName: string) {
  const normalized = databaseName.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (normalized.includes("pact") || normalized.includes("keycloak")) {
    throw new Error("LMS MONGO_DB_NAME must be LMS-specific and must not point at the PACT or Keycloak database.");
  }
}
