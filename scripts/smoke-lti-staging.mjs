import fs from "node:fs";
import { SignJWT, importPKCS8 } from "jose";

const options = parseArgs(process.argv.slice(2));
loadEnvFile(options.envFile ?? defaultEnvFile());

const lmsBaseUrl = cleanBaseUrl(options.lmsBaseUrl ?? process.env.LMS_STAGING_BASE_URL ?? "https://cetu-lms-api-staging.cetu.workers.dev");
const pactBaseUrl = cleanBaseUrl(options.pactBaseUrl ?? process.env.PACT_STAGING_BASE_URL ?? "https://cetu-pact-api-staging.cetu.workers.dev");
const clientId = options.clientId ?? process.env.PACT_LTI_CLIENT_ID ?? "pact-tool";
const deploymentId = options.deploymentId ?? firstCsvValue(process.env.PACT_LTI_DEPLOYMENT_IDS) ?? "pact-course-deployment";
const keyId = requireValue(process.env.LTI_PLATFORM_KID, "LTI_PLATFORM_KID");
const privateKeyPem = requireValue(process.env.LTI_PLATFORM_PRIVATE_KEY_PEM, "LTI_PLATFORM_PRIVATE_KEY_PEM").replace(/\\n/g, "\n");
const returnUrl = options.returnUrl ?? process.env.LMS_DEEP_LINK_RETURN_URL ?? `${lmsBaseUrl}/api/v1/lti/deep-linking/return`;

await assertJwks(`${lmsBaseUrl}/api/v1/lti/jwks`, "LMS");
await assertJwks(`${pactBaseUrl}/api/v1/lti/jwks`, "PACT");
await assertDeepLinkPost({
  pactDeepLinkUrl: `${pactBaseUrl}/api/v1/lti/deep-link`,
  lmsIssuer: lmsBaseUrl,
  clientId,
  deploymentId,
  keyId,
  privateKeyPem,
  returnUrl
});

console.log("LTI staging smoke passed.");

async function assertJwks(url, serviceName) {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`${serviceName} JWKS failed: ${response.status} ${safeSnippet(text)}`);
  }

  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`${serviceName} JWKS returned non-JSON content.`);
  }

  if (!Array.isArray(body.keys) || body.keys.length < 1) {
    throw new Error(`${serviceName} JWKS did not include any keys.`);
  }

  console.log(`${serviceName} JWKS OK (${body.keys.length} key${body.keys.length === 1 ? "" : "s"}).`);
}

async function assertDeepLinkPost(input) {
  const privateKey = await importPKCS8(input.privateKeyPem, "RS256");
  const idToken = await new SignJWT({
    "https://purl.imsglobal.org/spec/lti/claim/message_type": "LtiDeepLinkingRequest",
    "https://purl.imsglobal.org/spec/lti/claim/version": "1.3.0",
    "https://purl.imsglobal.org/spec/lti/claim/deployment_id": input.deploymentId,
    "https://purl.imsglobal.org/spec/lti/claim/target_link_uri": input.pactDeepLinkUrl,
    "https://purl.imsglobal.org/spec/lti/claim/context": { id: "cohort-pact-smoke", title: "PACT Staging Smoke" },
    "https://purl.imsglobal.org/spec/lti-dl/claim/deep_linking_settings": {
      deep_link_return_url: input.returnUrl,
      accept_types: ["ltiResourceLink"],
      accept_multiple: true,
      data: `smoke-${Date.now()}`
    }
  })
    .setProtectedHeader({ alg: "RS256", kid: input.keyId, typ: "JWT" })
    .setIssuer(input.lmsIssuer)
    .setAudience(input.clientId)
    .setSubject("staging-smoke")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);

  const response = await fetch(input.pactDeepLinkUrl, {
    method: "POST",
    headers: {
      accept: "text/html",
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({ id_token: idToken })
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`PACT Deep Linking POST failed: ${response.status} ${safeSnippet(text)}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html") || !text.includes('name="JWT"') || !text.includes(input.returnUrl)) {
    throw new Error("PACT Deep Linking POST did not return the expected signed form_post HTML.");
  }

  console.log("PACT Deep Linking POST OK.");
}

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const value = args[index + 1];

    if (arg === "--env-file") {
      parsed.envFile = value;
      index += 1;
    } else if (arg === "--lms-base-url") {
      parsed.lmsBaseUrl = value;
      index += 1;
    } else if (arg === "--pact-base-url") {
      parsed.pactBaseUrl = value;
      index += 1;
    } else if (arg === "--client-id") {
      parsed.clientId = value;
      index += 1;
    } else if (arg === "--deployment-id") {
      parsed.deploymentId = value;
      index += 1;
    } else if (arg === "--return-url") {
      parsed.returnUrl = value;
      index += 1;
    }
  }
  return parsed;
}

function loadEnvFile(path) {
  if (!path) return;
  if (!fs.existsSync(path)) {
    throw new Error(`Missing env file: ${path}`);
  }

  for (const rawLine of fs.readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separator = line.indexOf("=");
    if (separator < 1) continue;

    const key = line.slice(0, separator).trim();
    const value = stripQuotes(line.slice(separator + 1).trim());
    process.env[key] ??= value;
  }
}

function defaultEnvFile() {
  if (fs.existsSync(".env.staging")) return ".env.staging";
  if (fs.existsSync(".env")) return ".env";
  return undefined;
}

function stripQuotes(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function cleanBaseUrl(value) {
  return requireValue(value, "base URL").replace(/\/$/, "");
}

function firstCsvValue(value) {
  return value?.split(",").map((item) => item.trim()).find(Boolean);
}

function requireValue(value, name) {
  if (!value?.trim()) {
    throw new Error(`${name} is required for LTI staging smoke.`);
  }
  return value.trim();
}

function safeSnippet(value) {
  return value.replace(/\s+/g, " ").slice(0, 300);
}
