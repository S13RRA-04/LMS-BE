import type { CurrentUser } from "../auth/currentUser.js";
import type { MongoAuditLogRepository } from "../audit/mongoAuditLogRepository.js";
import { AppError, isAppError } from "../errors/AppError.js";
import type { KeycloakAdminClient } from "../integrations/keycloak/keycloakAdminClient.js";
import type { MongoUserRepository } from "./mongoUserRepository.js";
import type { AdminUser, CreateAdminUserInput, ResetAdminUserPasswordInput, UpdateAdminUserInput } from "./userTypes.js";

export class AdminUserService {
  constructor(
    private readonly keycloak: KeycloakAdminClient,
    private readonly users: MongoUserRepository,
    private readonly auditLogs?: MongoAuditLogRepository
  ) {}

  async listUsers() {
    try {
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
    } catch (error) {
      const projectedUsers = await this.users.listActive();
      if (!projectedUsers.length) {
        throw error;
      }
      return projectedUsers;
    }
    return this.users.listActive();
  }

  async findUserByEmail(email: string) {
    const existing = await this.users.getByEmail(email);
    if (existing) {
      return existing;
    }

    const syncedUser = await this.keycloak.findUserByEmail(email);
    if (!syncedUser) {
      return undefined;
    }

    return this.users.upsertFromKeycloak({
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
  }

  async createUser(actor: CurrentUser, requestId: string | undefined, input: CreateAdminUserInput) {
    const syncedUser = await this.createOrRecoverKeycloakUser(input);
    const user = await this.syncUser(syncedUser);

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

  async createUsers(actor: CurrentUser, requestId: string | undefined, inputs: CreateAdminUserInput[]) {
    const created: AdminUser[] = [];
    const failed: Array<{ row: number; username: string; email: string; code: string; message: string }> = [];

    for (const [index, input] of inputs.entries()) {
      try {
        created.push(await this.createUser(actor, requestId, input));
      } catch (error) {
        failed.push({
          row: index + 1,
          username: input.username,
          email: input.email,
          code: error instanceof AppError ? error.code : "USER_CREATE_FAILED",
          message: error instanceof Error ? error.message : "User creation failed"
        });
      }
    }

    await this.auditLogs?.record({
      action: "user.bulk_create",
      actor,
      targetType: "user",
      targetId: "bulk",
      requestId,
      metadata: { requested: inputs.length, created: created.length, failed: failed.length }
    });

    return { created, failed };
  }

  async resetPassword(actor: CurrentUser, requestId: string | undefined, id: string, input: ResetAdminUserPasswordInput) {
    const existing = await this.users.getById(id);
    if (!existing) {
      throw new AppError(404, "USER_NOT_FOUND", "User was not found");
    }

    const syncedUser = await this.keycloak.resetPassword(existing.keycloakSub, input.temporaryPassword);
    const user = await this.syncUser(syncedUser, existing.lastLoginAt);

    await this.auditLogs?.record({
      action: "user.password.reset",
      actor,
      targetType: "user",
      targetId: user.id,
      requestId,
      metadata: { keycloakSub: user.keycloakSub }
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
    let existing = await this.users.getById(id);
    if (!existing) {
      existing = await this.users.getByKeycloakSub(id);
    }
    if (!existing) {
      throw new AppError(404, "USER_NOT_FOUND", "User was not found");
    }

    await this.keycloak.deleteUser(existing.keycloakSub);
    await this.users.markDeleted(existing.id);
    await this.auditLogs?.record({
      action: "user.delete",
      actor,
      targetType: "user",
      targetId: existing.id,
      requestId,
      metadata: { keycloakSub: existing.keycloakSub }
    });
  }

  private async createOrRecoverKeycloakUser(input: CreateAdminUserInput) {
    try {
      return await this.keycloak.createUser(input);
    } catch (error) {
      if (!isAppError(error) || error.code !== "USER_EXISTS") {
        throw error;
      }

      const existing = await this.keycloak.findUserByEmail(input.email);
      if (!existing) {
        throw error;
      }

      return this.keycloak.updateUser(existing.keycloakSub, input);
    }
  }

  private async syncUser(syncedUser: Awaited<ReturnType<KeycloakAdminClient["getUser"]>>, lastLoginAt?: string) {
    return this.users.upsertFromKeycloak({
      keycloakSub: syncedUser.keycloakSub,
      username: syncedUser.username,
      email: syncedUser.email,
      name: syncedUser.name,
      role: syncedUser.role,
      roles: [syncedUser.role],
      permissions: syncedUser.permissions,
      departmentId: syncedUser.departmentId,
      enabled: syncedUser.enabled,
      lastLoginAt
    });
  }
}
