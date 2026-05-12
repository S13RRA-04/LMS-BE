import { describe, expect, it, vi } from "vitest";
import { KeycloakUserSyncService } from "../src/users/keycloakUserSyncService.js";
import type { KeycloakAdminClient } from "../src/integrations/keycloak/keycloakAdminClient.js";
import type { MongoUserRepository } from "../src/users/mongoUserRepository.js";

describe("Keycloak user sync service", () => {
  it("fetches the current Keycloak user and upserts the Mongo projection", async () => {
    const keycloak = {
      getUser: vi.fn().mockResolvedValue({
        keycloakSub: "keycloak-user-1",
        username: "learner-one",
        email: "learner@example.test",
        name: "Learner One",
        role: "instructor",
        permissions: ["lms_instructor"],
        departmentId: "cyber-training",
        enabled: true
      })
    };
    const users = {
      upsertFromKeycloak: vi.fn().mockResolvedValue({ id: "internal-user-1" })
    };
    const service = new KeycloakUserSyncService(keycloak as unknown as KeycloakAdminClient, users as unknown as MongoUserRepository);

    const result = await service.syncFromEvent({ operationType: "UPDATE", resourcePath: "users/keycloak-user-1" });

    expect(keycloak.getUser).toHaveBeenCalledWith("keycloak-user-1");
    expect(users.upsertFromKeycloak).toHaveBeenCalledWith(
      expect.objectContaining({
        keycloakSub: "keycloak-user-1",
        email: "learner@example.test",
        role: "instructor",
        permissions: ["lms_instructor"]
      })
    );
    expect(result).toMatchObject({ action: "upserted", keycloakSub: "keycloak-user-1" });
  });

  it("soft-deletes Mongo projections for Keycloak delete events", async () => {
    const keycloak = { getUser: vi.fn() };
    const users = {
      markDeletedByKeycloakSub: vi.fn().mockResolvedValue({ id: "internal-user-1" })
    };
    const service = new KeycloakUserSyncService(keycloak as unknown as KeycloakAdminClient, users as unknown as MongoUserRepository);

    const result = await service.syncFromEvent({ operationType: "DELETE", userId: "keycloak-user-1" });

    expect(keycloak.getUser).not.toHaveBeenCalled();
    expect(users.markDeletedByKeycloakSub).toHaveBeenCalledWith("keycloak-user-1");
    expect(result).toEqual({ action: "deleted", keycloakSub: "keycloak-user-1" });
  });
});
