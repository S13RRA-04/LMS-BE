import fs from "node:fs";
import path from "node:path";

const keycloakBaseUrl = process.env.KEYCLOAK_BOOTSTRAP_URL ?? "http://localhost:8080";
const adminUser = process.env.KEYCLOAK_BOOTSTRAP_ADMIN ?? "admin";
const adminPassword = process.env.KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD ?? "admin";
const realm = process.env.KEYCLOAK_REALM ?? "cetu";
const webClientId = process.env.KEYCLOAK_WEB_CLIENT_ID ?? "cetu-lms-web";
const apiClientId = process.env.KEYCLOAK_API_CLIENT_ID ?? "cetu-lms-api";

const token = await getAdminToken();

await upsertRealm();
const webClientUuid = await upsertClient(webClientId, {
  clientId: webClientId,
  enabled: true,
  publicClient: true,
  standardFlowEnabled: true,
  directAccessGrantsEnabled: true,
  redirectUris: ["http://127.0.0.1:5199/*", "http://localhost:5199/*", "http://127.0.0.1:5173/*", "http://localhost:5173/*"],
  webOrigins: ["http://127.0.0.1:5199", "http://localhost:5199", "http://127.0.0.1:5173", "http://localhost:5173"]
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
const adminSub = await upsertUser({
  username: "demo-admin",
  password: "AdminPass123!",
  email: "admin@example.test",
  firstName: "CETU",
  lastName: "Admin",
  roles: ["lms_learner", "lms_admin"]
});

upsertEnvValues({
  DEMO_LEARNER_KEYCLOAK_SUB: learnerSub,
  DEMO_ADMIN_KEYCLOAK_SUB: adminSub
});

console.log(`DEMO_LEARNER_KEYCLOAK_SUB=${learnerSub}`);
console.log(`DEMO_ADMIN_KEYCLOAK_SUB=${adminSub}`);
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
    lastName: input.lastName
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
