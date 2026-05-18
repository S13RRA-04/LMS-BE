import { AppError } from "../../errors/AppError.js";
import type { AppConfig } from "../../config/config.js";
import type { LmsRole } from "../../auth/currentUser.js";
import type { CreateAdminUserInput, UpdateAdminUserInput } from "../../users/userTypes.js";

type KeycloakUser = {
  id: string;
  username?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  enabled?: boolean;
  attributes?: Record<string, string[]>;
};

type KeycloakRole = {
  id: string;
  name: string;
};

const keycloakRoleByLmsRole: Record<LmsRole, string> = {
  learner: "lms_learner",
  instructor: "lms_instructor",
  admin: "lms_admin"
};

export type KeycloakSyncedUser = {
  keycloakSub: string;
  username?: string;
  email?: string;
  name?: string;
  role: LmsRole;
  permissions: string[];
  departmentId?: string;
  enabled: boolean;
};

export class KeycloakAdminClient {
  private accessToken?: { value: string; expiresAt: number };

  constructor(private readonly config: AppConfig) {}

  async listUsers(): Promise<KeycloakSyncedUser[]> {
    const users = await this.request<KeycloakUser[]>("/users?max=500");
    return Promise.all(users.map((user) => this.toSyncedUser(user)));
  }

  async createUser(input: CreateAdminUserInput): Promise<KeycloakSyncedUser> {
    const response = await this.requestResponse("/users", {
      method: "POST",
      body: this.userPayload(input)
    }).catch((error: unknown) => {
      if (error instanceof AppError && error.code === "KEYCLOAK_ADMIN_CONFLICT") {
        throw new AppError(409, "USER_EXISTS", "User already exists");
      }
      throw error;
    });

    const location = response.headers.get("location");
    const keycloakSub = location?.split("/").filter(Boolean).at(-1);
    if (!keycloakSub) {
      throw new AppError(502, "KEYCLOAK_USER_CREATE_FAILED", "Keycloak did not return a created user id");
    }

    if (input.temporaryPassword) {
      await this.setTemporaryPassword(keycloakSub, input.temporaryPassword);
    }

    await this.replaceLmsRole(keycloakSub, input.role);
    return this.getUser(keycloakSub);
  }

  async updateUser(keycloakSub: string, input: UpdateAdminUserInput): Promise<KeycloakSyncedUser> {
    const existing = await this.getRawUser(keycloakSub);
    await this.request(`/users/${encodeURIComponent(keycloakSub)}`, {
      method: "PUT",
      body: this.userPayload(input, existing)
    });

    if (input.temporaryPassword) {
      await this.setTemporaryPassword(keycloakSub, input.temporaryPassword);
    }

    if (input.role) {
      await this.replaceLmsRole(keycloakSub, input.role);
    }

    return this.getUser(keycloakSub);
  }

  async deleteUser(keycloakSub: string): Promise<void> {
    try {
      await this.request(`/users/${encodeURIComponent(keycloakSub)}`, { method: "DELETE" });
    } catch (error: unknown) {
      if (error instanceof AppError && error.code === "KEYCLOAK_ADMIN_NOT_FOUND") {
        return;
      }
      throw error;
    }
  }

  async getUser(keycloakSub: string): Promise<KeycloakSyncedUser> {
    return this.toSyncedUser(await this.getRawUser(keycloakSub));
  }

  async findUserByEmail(email: string): Promise<KeycloakSyncedUser | undefined> {
    const normalizedEmail = email.trim().toLowerCase();
    const users = await this.request<KeycloakUser[]>(`/users?exact=true&email=${encodeURIComponent(normalizedEmail)}&max=2`);
    const user = users.find((item) => item.email?.toLowerCase() === normalizedEmail) ?? users[0];
    return user ? this.toSyncedUser(user) : undefined;
  }

  private async getRawUser(keycloakSub: string): Promise<KeycloakUser> {
    return this.request<KeycloakUser>(`/users/${encodeURIComponent(keycloakSub)}`);
  }

  private async toSyncedUser(user: KeycloakUser): Promise<KeycloakSyncedUser> {
    const roles = await this.getUserLmsRoles(user.id);
    const role = primaryRole(roles);
    return {
      keycloakSub: user.id,
      username: user.username,
      email: user.email,
      name: [user.firstName, user.lastName].filter(Boolean).join(" ") || user.username,
      role,
      permissions: [keycloakRoleByLmsRole[role]],
      departmentId: user.attributes?.departmentId?.[0],
      enabled: user.enabled ?? true
    };
  }

  private userPayload(input: CreateAdminUserInput | UpdateAdminUserInput, existing?: KeycloakUser) {
    const [firstName, ...rest] = (input.name ?? [existing?.firstName, existing?.lastName].filter(Boolean).join(" ")).trim().split(/\s+/);
    return {
      username: input.username ?? existing?.username,
      email: input.email ?? existing?.email,
      firstName: firstName || undefined,
      lastName: rest.join(" ") || undefined,
      enabled: input.enabled ?? existing?.enabled ?? true,
      emailVerified: true,
      attributes: {
        ...(existing?.attributes ?? {}),
        departmentId: input.departmentId ? [input.departmentId] : existing?.attributes?.departmentId
      }
    };
  }

  private async replaceLmsRole(keycloakSub: string, role: LmsRole) {
    const clientUuid = await this.getApiClientUuid();
    const currentRoles = await this.request<KeycloakRole[]>(`/users/${encodeURIComponent(keycloakSub)}/role-mappings/clients/${clientUuid}`);
    const lmsRoles = currentRoles.filter((currentRole) => Object.values(keycloakRoleByLmsRole).includes(currentRole.name));
    if (lmsRoles.length) {
      await this.request(`/users/${encodeURIComponent(keycloakSub)}/role-mappings/clients/${clientUuid}`, {
        method: "DELETE",
        body: lmsRoles
      });
    }

    const nextRole = await this.request<KeycloakRole>(`/clients/${clientUuid}/roles/${keycloakRoleByLmsRole[role]}`);
    await this.request(`/users/${encodeURIComponent(keycloakSub)}/role-mappings/clients/${clientUuid}`, {
      method: "POST",
      body: [nextRole]
    });
  }

  private async getUserLmsRoles(keycloakSub: string): Promise<LmsRole[]> {
    const clientUuid = await this.getApiClientUuid();
    const roles = await this.request<KeycloakRole[]>(`/users/${encodeURIComponent(keycloakSub)}/role-mappings/clients/${clientUuid}`);
    return roles.map((role) => lmsRoleFromKeycloakRole(role.name)).filter((role): role is LmsRole => Boolean(role));
  }

  private async setTemporaryPassword(keycloakSub: string, password: string) {
    await this.request(`/users/${encodeURIComponent(keycloakSub)}/reset-password`, {
      method: "PUT",
      body: { type: "password", value: password, temporary: true }
    });
  }

  private async getApiClientUuid(): Promise<string> {
    const clients = await this.request<Array<{ id: string; clientId: string }>>(`/clients?clientId=${encodeURIComponent(this.config.keycloakAudience)}`);
    const client = clients.find((item) => item.clientId === this.config.keycloakAudience);
    if (!client) {
      throw new AppError(502, "KEYCLOAK_CLIENT_NOT_FOUND", "Keycloak API client was not found");
    }
    return client.id;
  }

  private async request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const response = await this.requestResponse(path, init);
    if (response.status === 204) {
      return undefined as T;
    }
    return response.json() as Promise<T>;
  }

  private async requestResponse(path: string, init: { method?: string; body?: unknown } = {}) {
    const token = await this.getAccessToken();
    const response = await fetch(`${this.adminRealmUrl()}${path}`, {
      method: init.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(init.body === undefined ? {} : { "Content-Type": "application/json" })
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body)
    });

    if (!response.ok) {
      if (response.status === 409) {
        throw new AppError(409, "KEYCLOAK_ADMIN_CONFLICT", "Keycloak admin request conflicted with an existing resource");
      }
      if (response.status === 404) {
        throw new AppError(404, "KEYCLOAK_ADMIN_NOT_FOUND", "Keycloak admin resource was not found");
      }
      throw new AppError(502, "KEYCLOAK_ADMIN_REQUEST_FAILED", "Keycloak admin request failed");
    }

    return response;
  }

  private async getAccessToken() {
    if (this.accessToken && this.accessToken.expiresAt > Date.now() + 30_000) {
      return this.accessToken.value;
    }

    if (!this.config.keycloakAdminBaseUrl || !this.config.keycloakAdminClientId) {
      throw new AppError(503, "KEYCLOAK_ADMIN_NOT_CONFIGURED", "Keycloak admin integration is not configured");
    }

    const body = new URLSearchParams({ client_id: this.config.keycloakAdminClientId });
    if (this.config.keycloakAdminClientSecret) {
      body.set("grant_type", "client_credentials");
      body.set("client_secret", this.config.keycloakAdminClientSecret);
    } else if (this.config.keycloakAdminUsername && this.config.keycloakAdminPassword) {
      body.set("grant_type", "password");
      body.set("username", this.config.keycloakAdminUsername);
      body.set("password", this.config.keycloakAdminPassword);
    } else {
      throw new AppError(503, "KEYCLOAK_ADMIN_NOT_CONFIGURED", "Keycloak admin credentials are not configured");
    }

    const response = await fetch(`${this.config.keycloakAdminBaseUrl}/realms/${this.config.keycloakAdminTokenRealm}/protocol/openid-connect/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body
    });

    if (!response.ok) {
      throw new AppError(502, "KEYCLOAK_ADMIN_AUTH_FAILED", "Keycloak admin authentication failed");
    }

    const payload = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!payload.access_token) {
      throw new AppError(502, "KEYCLOAK_ADMIN_AUTH_FAILED", "Keycloak admin authentication failed");
    }

    this.accessToken = {
      value: payload.access_token,
      expiresAt: Date.now() + (payload.expires_in ?? 60) * 1000
    };
    return this.accessToken.value;
  }

  private adminRealmUrl() {
    return `${this.config.keycloakAdminBaseUrl}/admin/realms/${this.config.keycloakAdminRealm}`;
  }
}

function lmsRoleFromKeycloakRole(role: string): LmsRole | undefined {
  if (role === "lms_admin" || role === "admin") return "admin";
  if (role === "lms_instructor" || role === "instructor") return "instructor";
  if (role === "lms_learner" || role === "learner") return "learner";
  return undefined;
}

function primaryRole(roles: LmsRole[]): LmsRole {
  if (roles.includes("admin")) return "admin";
  if (roles.includes("instructor")) return "instructor";
  return "learner";
}
