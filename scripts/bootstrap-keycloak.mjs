import fs from "node:fs";
import path from "node:path";

const keycloakBaseUrl = process.env.KEYCLOAK_BOOTSTRAP_URL ?? "http://localhost:8080";
const keycloakPublicBaseUrl = process.env.KEYCLOAK_PUBLIC_BASE_URL?.replace(/\/$/, "");
const adminUser = process.env.KEYCLOAK_BOOTSTRAP_ADMIN ?? "admin";
const adminPassword = process.env.KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD ?? "admin";
const realm = process.env.KEYCLOAK_REALM ?? "cetu";
const webClientId = process.env.KEYCLOAK_WEB_CLIENT_ID ?? "cetu-lms-web";
const apiClientId = process.env.KEYCLOAK_API_CLIENT_ID ?? "cetu-lms-api";
const primaryAdminEmail = process.env.KEYCLOAK_PRIMARY_ADMIN_EMAIL ?? "m.codyhitson@gmail.com";
const primaryAdminUsername = process.env.KEYCLOAK_PRIMARY_ADMIN_USERNAME ?? primaryAdminEmail;
const webOrigins = buildWebOrigins();

const token = await getAdminToken();

await upsertRealm();
await configureRealmPublicUrl();
await enablePasswordlessRequiredAction();
await configurePasswordlessBrowserFlow();
await configurePasswordlessPolicy();
const webClientUuid = await upsertClient(webClientId, {
  clientId: webClientId,
  enabled: true,
  publicClient: true,
  standardFlowEnabled: true,
  directAccessGrantsEnabled: true,
  redirectUris: webOrigins.map((origin) => `${origin}/*`),
  webOrigins
});
const apiClientUuid = await upsertClient(apiClientId, {
  clientId: apiClientId,
  enabled: true,
  publicClient: false,
  bearerOnly: false,
  serviceAccountsEnabled: false,
  standardFlowEnabled: false,
  directAccessGrantsEnabled: false
});

await upsertClientRole(apiClientUuid, "lms_learner");
await upsertClientRole(apiClientUuid, "lms_instructor");
await upsertClientRole(apiClientUuid, "lms_admin");
await upsertAudienceMapper(webClientUuid);

const learnerSub = await upsertUser({
  username: "demo-learner",
  password: "LearnerPass123!",
  email: "learner@example.test",
  firstName: "CETU",
  lastName: "Learner",
  roles: ["lms_learner"]
});
const instructorSub = await upsertUser({
  username: "demo-instructor",
  password: "InstructorPass123!",
  email: "instructor@example.test",
  firstName: "CETU",
  lastName: "Instructor",
  roles: ["lms_instructor"]
});
const adminSub = await upsertUser({
  username: "demo-admin",
  password: "AdminPass123!",
  email: "admin@example.test",
  firstName: "CETU",
  lastName: "Admin",
  roles: ["lms_admin"]
});
const primaryAdminSub = await upsertUser({
  username: primaryAdminUsername,
  password: primaryAdminInitialPassword(),
  email: primaryAdminEmail,
  firstName: "Cody",
  lastName: "Hitson",
  roles: ["lms_admin"],
  requiredActions: ["webauthn-register-passwordless"]
});
await assignRealmAdmin(primaryAdminSub);

upsertEnvValues({
  DEMO_LEARNER_KEYCLOAK_SUB: learnerSub,
  DEMO_INSTRUCTOR_KEYCLOAK_SUB: instructorSub,
  DEMO_ADMIN_KEYCLOAK_SUB: adminSub,
  PRIMARY_ADMIN_KEYCLOAK_SUB: primaryAdminSub
});

console.log(`DEMO_LEARNER_KEYCLOAK_SUB=${learnerSub}`);
console.log(`DEMO_INSTRUCTOR_KEYCLOAK_SUB=${instructorSub}`);
console.log(`DEMO_ADMIN_KEYCLOAK_SUB=${adminSub}`);
console.log(`PRIMARY_ADMIN_KEYCLOAK_SUB=${primaryAdminSub}`);
console.log("Keycloak local development realm is ready");

async function getAdminToken() {
  const body = new URLSearchParams({
    grant_type: "password",
    client_id: "admin-cli",
    username: adminUser,
    password: adminPassword
  });
  const response = await fetch(`${keycloakBaseUrl}/realms/master/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const payload = await parseJson(response);
  if (!response.ok) {
    throw new Error(`Keycloak admin login failed: ${response.status} ${JSON.stringify(payload)}`);
  }
  return payload.access_token;
}

async function upsertRealm() {
  const existing = await request(`/admin/realms/${realm}`, { allowNotFound: true });
  if (existing) {
    return;
  }
  await request("/admin/realms", {
    method: "POST",
    body: {
      realm,
      enabled: true,
      registrationAllowed: false,
      resetPasswordAllowed: true,
      loginWithEmailAllowed: true
    }
  });
}

async function configureRealmPublicUrl() {
  if (!keycloakPublicBaseUrl) {
    return;
  }

  const current = await request(`/admin/realms/${realm}`);
  await request(`/admin/realms/${realm}`, {
    method: "PUT",
    body: {
      ...current,
      attributes: {
        ...(current.attributes ?? {}),
        frontendUrl: keycloakPublicBaseUrl
      }
    }
  });
}

async function configurePasswordlessPolicy() {
  const current = await request(`/admin/realms/${realm}`);
  await request(`/admin/realms/${realm}`, {
    method: "PUT",
    body: {
      ...current,
      browserFlow: "cetu browser passwordless",
      webAuthnPolicyPasswordlessRpEntityName: "CETU",
      webAuthnPolicyPasswordlessSignatureAlgorithms: ["ES256", "RS256"],
      webAuthnPolicyPasswordlessAttestationConveyancePreference: "not specified",
      webAuthnPolicyPasswordlessAuthenticatorAttachment: "not specified",
      webAuthnPolicyPasswordlessRequireResidentKey: "Yes",
      webAuthnPolicyPasswordlessUserVerificationRequirement: "required",
      webAuthnPolicyPasswordlessCreateTimeout: 0,
      webAuthnPolicyPasswordlessAvoidSameAuthenticatorRegister: true,
      webAuthnPolicyPasswordlessAcceptableAaguids: [],
      webAuthnPolicyPasswordlessExtraOrigins: []
    }
  });
}

async function enablePasswordlessRequiredAction() {
  const actions = await request(`/admin/realms/${realm}/authentication/required-actions`);
  const action = actions.find((item) => item.alias === "webauthn-register-passwordless");
  if (!action) {
    throw new Error("Keycloak does not expose the webauthn-register-passwordless required action");
  }

  await request(`/admin/realms/${realm}/authentication/required-actions/${action.alias}`, {
    method: "PUT",
    body: {
      ...action,
      enabled: true,
      defaultAction: false
    }
  });
}

async function configurePasswordlessBrowserFlow() {
  const flowAlias = "cetu browser passwordless";
  const existing = await findFlow(flowAlias);
  if (!existing) {
    await request(`/admin/realms/${realm}/authentication/flows/browser/copy`, {
      method: "POST",
      body: { newName: flowAlias }
    });
  }

  await addAuthenticatorIfMissing(flowAlias, "webauthn-authenticator-passwordless");
  await setExecutionRequirement(flowAlias, "webauthn-authenticator-passwordless", "ALTERNATIVE");
}

async function findFlow(alias) {
  const flows = await request(`/admin/realms/${realm}/authentication/flows`);
  return flows.find((flow) => flow.alias === alias);
}

async function addAuthenticatorIfMissing(flowAlias, provider) {
  const executions = await flowExecutions(flowAlias);
  if (executions.some((execution) => execution.providerId === provider)) {
    return;
  }

  await request(`/admin/realms/${realm}/authentication/flows/${encodeURIComponent(flowAlias)}/executions/execution`, {
    method: "POST",
    body: { provider }
  });
}

async function setExecutionRequirement(flowAlias, provider, requirement) {
  const execution = (await flowExecutions(flowAlias)).find((item) => item.providerId === provider);
  if (!execution) {
    throw new Error(`Missing ${provider} execution in ${flowAlias}`);
  }

  await request(`/admin/realms/${realm}/authentication/flows/${encodeURIComponent(flowAlias)}/executions`, {
    method: "PUT",
    body: {
      id: execution.id,
      requirement
    }
  });
}

async function flowExecutions(flowAlias) {
  return request(`/admin/realms/${realm}/authentication/flows/${encodeURIComponent(flowAlias)}/executions`);
}

async function upsertClient(clientId, body) {
  const existing = await findClient(clientId);
  if (existing) {
    await request(`/admin/realms/${realm}/clients/${existing.id}`, { method: "PUT", body: { ...existing, ...body } });
    return existing.id;
  }
  await request(`/admin/realms/${realm}/clients`, { method: "POST", body });
  return (await findClient(clientId)).id;
}

async function findClient(clientId) {
  const clients = await request(`/admin/realms/${realm}/clients?clientId=${encodeURIComponent(clientId)}`);
  return clients[0];
}

async function upsertClientRole(clientUuid, roleName) {
  const existing = await request(`/admin/realms/${realm}/clients/${clientUuid}/roles/${roleName}`, { allowNotFound: true });
  if (!existing) {
    await request(`/admin/realms/${realm}/clients/${clientUuid}/roles`, {
      method: "POST",
      body: { name: roleName, description: roleName }
    });
  }
}

async function upsertAudienceMapper(webClientUuid) {
  const mappers = await request(`/admin/realms/${realm}/clients/${webClientUuid}/protocol-mappers/models`);
  const existing = mappers.find((mapper) => mapper.name === "cetu-lms-api-audience");
  const mapper = {
    name: "cetu-lms-api-audience",
    protocol: "openid-connect",
    protocolMapper: "oidc-audience-mapper",
    config: {
      "included.client.audience": apiClientId,
      "access.token.claim": "true",
      "id.token.claim": "false"
    }
  };
  if (existing) {
    await request(`/admin/realms/${realm}/clients/${webClientUuid}/protocol-mappers/models/${existing.id}`, {
      method: "PUT",
      body: { ...existing, ...mapper }
    });
    return;
  }
  await request(`/admin/realms/${realm}/clients/${webClientUuid}/protocol-mappers/models`, { method: "POST", body: mapper });
}

async function upsertUser(input) {
  const existing = await findUser(input.username);
  const userBody = {
    username: input.username,
    enabled: true,
    email: input.email,
    firstName: input.firstName,
    lastName: input.lastName,
    emailVerified: true,
    requiredActions: input.requiredActions ?? []
  };
  let userId = existing?.id;
  if (userId) {
    await request(`/admin/realms/${realm}/users/${userId}`, { method: "PUT", body: { ...existing, ...userBody } });
  } else {
    await request(`/admin/realms/${realm}/users`, { method: "POST", body: userBody });
    userId = (await findUser(input.username)).id;
  }

  await request(`/admin/realms/${realm}/users/${userId}/reset-password`, {
    method: "PUT",
    body: { type: "password", value: input.password, temporary: false }
  });

  const roles = await Promise.all(input.roles.map((role) => request(`/admin/realms/${realm}/clients/${apiClientUuid}/roles/${role}`)));
  await request(`/admin/realms/${realm}/users/${userId}/role-mappings/clients/${apiClientUuid}`, {
    method: "POST",
    body: roles,
    ignoreStatuses: [409]
  });

  return userId;
}

async function assignRealmAdmin(userId) {
  const realmManagementClient = await findClient("realm-management");
  if (!realmManagementClient) {
    throw new Error("Missing Keycloak realm-management client");
  }

  const role = await request(`/admin/realms/${realm}/clients/${realmManagementClient.id}/roles/realm-admin`);
  await request(`/admin/realms/${realm}/users/${userId}/role-mappings/clients/${realmManagementClient.id}`, {
    method: "POST",
    body: [role],
    ignoreStatuses: [409]
  });
}

async function findUser(username) {
  const users = await request(`/admin/realms/${realm}/users?username=${encodeURIComponent(username)}&exact=true`);
  return users[0];
}

async function request(resource, options = {}) {
  const response = await fetch(`${keycloakBaseUrl}${resource}`, {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  if (options.allowNotFound && response.status === 404) {
    return undefined;
  }
  if (options.ignoreStatuses?.includes(response.status)) {
    return undefined;
  }

  const payload = await parseJson(response);
  if (!response.ok) {
    throw new Error(`Keycloak request failed ${response.status} ${resource}: ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function parseJson(response) {
  const text = await response.text();
  if (!text) {
    return undefined;
  }
  return JSON.parse(text);
}

function upsertEnvValues(values) {
  const envPath = path.resolve(".env");
  const current = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8").split(/\r?\n/) : [];
  const keys = new Set(Object.keys(values));
  const next = current
    .filter((line) => {
      const key = line.split("=", 1)[0];
      return !keys.has(key);
    })
    .filter((line, index, lines) => line || index < lines.length - 1);

  for (const [key, value] of Object.entries(values)) {
    next.push(`${key}=${value}`);
  }

  fs.writeFileSync(envPath, `${next.join("\n")}\n`);
}

function buildWebOrigins() {
  const ports = new Set(["5173", "5174", "5181", "5199"]);
  const stagingOrigins = new Set([
    "https://cetu-lms-web-staging.pages.dev",
    "https://lms-staging.cetu.online"
  ]);
  for (const port of (process.env.KEYCLOAK_WEB_REDIRECT_PORTS ?? "").split(",")) {
    const trimmed = port.trim();
    if (trimmed) {
      ports.add(trimmed);
    }
  }

  const origins = new Set([
    ...stagingOrigins,
    ...[...ports].flatMap((port) => [`http://127.0.0.1:${port}`, `http://localhost:${port}`])
  ]);
  for (const origin of (process.env.KEYCLOAK_WEB_EXTRA_ORIGINS ?? "").split(",")) {
    const trimmed = origin.trim().replace(/\/$/, "");
    if (trimmed) {
      origins.add(trimmed);
    }
  }

  return [...origins];
}

function primaryAdminInitialPassword() {
  const configured = process.env.KEYCLOAK_PRIMARY_ADMIN_TEMP_PASSWORD;
  if (configured) {
    return configured;
  }

  if (new URL(keycloakBaseUrl).hostname === "localhost") {
    return "AdminPass123!";
  }

  throw new Error("KEYCLOAK_PRIMARY_ADMIN_TEMP_PASSWORD is required when bootstrapping a non-local Keycloak admin user");
}
