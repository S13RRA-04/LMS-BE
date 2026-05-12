import { AppError } from "../errors/AppError.js";
import type { KeycloakAdminClient } from "../integrations/keycloak/keycloakAdminClient.js";
import type { MongoUserRepository } from "./mongoUserRepository.js";

export type KeycloakUserSyncEvent = {
  operationType?: string;
  resourceType?: string;
  resourcePath?: string;
  userId?: string;
  keycloakSub?: string;
};

const deleteOperations = new Set(["DELETE", "REMOVE"]);

export class KeycloakUserSyncService {
  constructor(
    private readonly keycloak: KeycloakAdminClient,
    private readonly users: MongoUserRepository
  ) {}

  async syncFromEvent(event: KeycloakUserSyncEvent) {
    const keycloakSub = extractKeycloakSub(event);
    if (!keycloakSub) {
      throw new AppError(400, "KEYCLOAK_USER_ID_REQUIRED", "Keycloak user event did not include a user id");
    }

    if (deleteOperations.has((event.operationType ?? "").toUpperCase())) {
      await this.users.markDeletedByKeycloakSub(keycloakSub);
      return { keycloakSub, action: "deleted" as const };
    }

    const syncedUser = await this.keycloak.getUser(keycloakSub);
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

    return { keycloakSub, action: "upserted" as const, user };
  }
}

function extractKeycloakSub(event: KeycloakUserSyncEvent) {
  if (event.keycloakSub) return event.keycloakSub;
  if (event.userId) return event.userId;

  const match = event.resourcePath?.match(/(?:^|\/)users\/([^/?#]+)/i);
  return match?.[1];
}
