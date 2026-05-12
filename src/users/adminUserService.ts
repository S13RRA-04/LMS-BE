import type { CurrentUser } from "../auth/currentUser.js";
import type { MongoAuditLogRepository } from "../audit/mongoAuditLogRepository.js";
import { AppError } from "../errors/AppError.js";
import type { KeycloakAdminClient } from "../integrations/keycloak/keycloakAdminClient.js";
import type { MongoUserRepository } from "./mongoUserRepository.js";
import type { CreateAdminUserInput, UpdateAdminUserInput } from "./userTypes.js";

export class AdminUserService {
  constructor(
    private readonly keycloak: KeycloakAdminClient,
    private readonly users: MongoUserRepository,
    private readonly auditLogs?: MongoAuditLogRepository
  ) {}

  async listUsers() {
    const syncedUsers = await this.keycloak.listUsers();
    for (const user of syncedUsers) {
      await this.users.upsertFromKeycloak({
        keycloakSub: user.keycloakSub,
        username: user.username,
        email: user.email,
        name: user.name,
        role: user.role,
        roles: [user.role],
        permissions: user.permissions,
        departmentId: user.departmentId,
        enabled: user.enabled,
        lastLoginAt: undefined
      });
    }
    return this.users.listActive();
  }

  async createUser(actor: CurrentUser, requestId: string | undefined, input: CreateAdminUserInput) {
    const syncedUser = await this.keycloak.createUser(input);
    const user = await this.users.upsertFromKeycloak({
      keycloakSub: syncedUser.keycloakSub,
      username: syncedUser.username,
      email: syncedUser.email,
      name: syncedUser.name,
      role: syncedUser.role,
      roles: [syncedUser.role],
      permissions: syncedUser.permissions,
      departmentId: syncedUser.departmentId,
      enabled: syncedUser.enabled,
      lastLoginAt: undefined
    });

    await this.auditLogs?.record({
      action: "user.create",
      actor,
      targetType: "user",
      targetId: user.id,
      requestId,
      metadata: { role: user.role, enabled: user.enabled }
    });

    return user;
  }

  async updateUser(actor: CurrentUser, requestId: string | undefined, id: string, input: UpdateAdminUserInput) {
    const existing = await this.users.getById(id);
    if (!existing) {
      throw new AppError(404, "USER_NOT_FOUND", "User was not found");
    }

    const syncedUser = await this.keycloak.updateUser(existing.keycloakSub, input);
    const user = await this.users.upsertFromKeycloak({
      keycloakSub: syncedUser.keycloakSub,
      username: syncedUser.username,
      email: syncedUser.email,
      name: syncedUser.name,
      role: syncedUser.role,
      roles: [syncedUser.role],
      permissions: syncedUser.permissions,
      departmentId: syncedUser.departmentId,
      enabled: syncedUser.enabled,
      lastLoginAt: existing.lastLoginAt
    });

    await this.auditLogs?.record({
      action: "user.update",
      actor,
      targetType: "user",
      targetId: user.id,
      requestId,
      metadata: { changedFields: Object.keys(input).filter((field) => field !== "temporaryPassword") }
    });

    return user;
  }

  async deleteUser(actor: CurrentUser, requestId: string | undefined, id: string) {
    if (actor.id === id) {
      throw new AppError(400, "CANNOT_DELETE_SELF", "Admins cannot delete their own user");
    }

    const existing = await this.users.getById(id);
    if (!existing) {
      throw new AppError(404, "USER_NOT_FOUND", "User was not found");
    }

    await this.keycloak.deleteUser(existing.keycloakSub);
    await this.users.markDeleted(id);
    await this.auditLogs?.record({
      action: "user.delete",
      actor,
      targetType: "user",
      targetId: id,
      requestId,
      metadata: { keycloakSub: existing.keycloakSub }
    });
  }
}
