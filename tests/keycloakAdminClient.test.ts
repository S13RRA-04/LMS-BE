import { describe, expect, it, vi } from "vitest";
import { AppError } from "../src/errors/AppError.js";
import { KeycloakAdminClient } from "../src/integrations/keycloak/keycloakAdminClient.js";

describe("KeycloakAdminClient", () => {
  it("ignores missing Keycloak users when deleting", async () => {
    const client = new KeycloakAdminClient({
      keycloakAdminBaseUrl: "http://keycloak.test",
      keycloakAdminRealm: "cetu",
      keycloakAdminTokenRealm: "cetu",
      keycloakAdminClientId: "admin-client",
      keycloakAdminClientSecret: "secret",
      keycloakAudience: "cetu-lms-api",
      keycloakIssuer: "http://keycloak.test/realms/cetu",
      keycloakJwksUri: "http://keycloak.test/realms/cetu/protocol/openid-connect/certs",
      env: "test",
      mongoDbName: "test"
    } as any);

    const error = new AppError(404, "KEYCLOAK_ADMIN_NOT_FOUND", "Keycloak admin resource was not found");
    client["request"] = vi.fn().mockRejectedValue(error);

    await expect(client.deleteUser("missing-user")).resolves.toBeUndefined();
    expect(client["request"]).toHaveBeenCalledWith("/users/missing-user", { method: "DELETE" });
  });
});
