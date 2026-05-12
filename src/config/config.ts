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
  ltiPlatformKid: string;
  ltiPlatformPrivateKeyPem: string;
  registeredTools: RegisteredToolConfig[];
  corsOrigins: string[];
};

export function loadConfig(source: NodeJS.ProcessEnv): AppConfig {
  const parsed = envSchema.parse(source);
  const tools = z.array(registeredToolSchema).parse(JSON.parse(parsed.LTI_TOOLS_JSON));

  return {
    env: parsed.NODE_ENV,
    port: parsed.PORT,
    appBaseUrl: parsed.APP_BASE_URL.replace(/\/$/, ""),
    mongoUri: parsed.MONGO_URI,
    mongoDbName: parsed.MONGO_DB_NAME,
    mongoCollectionPrefix: parsed.MONGO_COLLECTION_PREFIX ?? (parsed.NODE_ENV === "production" ? "" : "staging_"),
    mongoTlsCertKeyFile: parsed.MONGO_TLS_CERT_KEY_FILE,
    keycloakIssuer: parsed.KEYCLOAK_ISSUER.replace(/\/$/, ""),
    keycloakAudience: parsed.KEYCLOAK_AUDIENCE,
    keycloakJwksUri:
      parsed.KEYCLOAK_JWKS_URI ??
      `${parsed.KEYCLOAK_ISSUER.replace(/\/$/, "")}/protocol/openid-connect/certs`,
    ltiIssuer: parsed.LTI_ISSUER.replace(/\/$/, ""),
    ltiPlatformKid: parsed.LTI_PLATFORM_KID,
    ltiPlatformPrivateKeyPem: parsed.LTI_PLATFORM_PRIVATE_KEY_PEM.replace(/\\n/g, "\n"),
    registeredTools: tools,
    corsOrigins: parsed.CORS_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean)
  };
}
