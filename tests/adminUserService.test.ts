import { describe, expect, it, vi } from "vitest";
import { AdminUserService } from "../src/users/adminUserService.js";
import type { KeycloakAdminClient, KeycloakSyncedUser } from "../src/integrations/keycloak/keycloakAdminClient.js";
import type { MongoUserRepository } from "../src/users/mongoUserRepository.js";

const actor = { id: "admin-user", role: "admin" as const, roles: ["admin" as const], permissions: [] };

describe("LMS admin user management", () => {
  it("creates users in Keycloak and syncs the internal LMS projection", async () => {
    const keycloakUser: KeycloakSyncedUser = {
      keycloakSub: "keycloak-new-user",
      username: "new-learner",
      email: "new@example.test",
      name: "New Learner",
      role: "learner",
      permissions: ["lms_learner"],
      enabled: true
    };
    const keycloak = { createUser: vi.fn().mockResolvedValue(keycloakUser) };
    const users = {
      upsertFromKeycloak: vi.fn().mockImplementation((input) =>
        Promise.resolve({
          id: "internal-new-user",
          roles: [input.role],
          createdAt: "2026-05-12T00:00:00.000Z",
          updatedAt: "2026-05-12T00:00:00.000Z",
          ...input
        })
      )
    };
    const auditLogs = { record: vi.fn().mockResolvedValue(undefined) };
    const service = new AdminUserService(keycloak as unknown as KeycloakAdminClient, users as unknown as MongoUserRepository, auditLogs as never);

    const user = await service.createUser(actor, "request-1", {
      username: "new-learner",
      email: "new@example.test",
      role: "learner",
      enabled: true
    });

    expect(keycloak.createUser).toHaveBeenCalledWith({
      username: "new-learner",
      email: "new@example.test",
      role: "learner",
      enabled: true
    });
    expect(users.upsertFromKeycloak).toHaveBeenCalledWith(expect.objectContaining({ keycloakSub: "keycloak-new-user", role: "learner" }));
    expect(auditLogs.record).toHaveBeenCalledWith(expect.objectContaining({ action: "user.create", targetId: "internal-new-user" }));
    expect(user).toMatchObject({ id: "internal-new-user", email: "new@example.test" });
  });

  it("soft-deletes the internal projection after deleting the Keycloak user", async () => {
    const keycloak = { deleteUser: vi.fn().mockResolvedValue(undefined) };
    const users = {
      getById: vi.fn().mockResolvedValue({ id: "learner-1", keycloakSub: "keycloak-learner-1" }),
      markDeleted: vi.fn().mockResolvedValue(undefined)
    };
    const auditLogs = { record: vi.fn().mockResolvedValue(undefined) };
    const service = new AdminUserService(keycloak as unknown as KeycloakAdminClient, users as unknown as MongoUserRepository, auditLogs as never);

    await service.deleteUser(actor, "request-2", "learner-1");

    expect(keycloak.deleteUser).toHaveBeenCalledWith("keycloak-learner-1");
    expect(users.markDeleted).toHaveBeenCalledWith("learner-1");
    expect(auditLogs.record).toHaveBeenCalledWith(expect.objectContaining({ action: "user.delete", targetId: "learner-1" }));
  });
});
