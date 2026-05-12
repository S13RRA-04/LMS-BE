import type { AppConfig } from "../../config/config.js";
import { AppError } from "../../errors/AppError.js";
import { CLIENT_ASSERTION_TYPE } from "../ltiConstants.js";
import type { ToolRegistrationRepository } from "../repositories/toolRegistrationRepository.js";
import type { PlatformKeyService } from "./platformKeyService.js";
import type { ToolAssertionService } from "./toolAssertionService.js";

export type TokenRequest = {
  grant_type: string;
  client_assertion_type: string;
  client_assertion: string;
  scope?: string;
};

export class LtiTokenService {
  constructor(
    private readonly config: AppConfig,
    private readonly tools: ToolRegistrationRepository,
    private readonly assertions: ToolAssertionService,
    private readonly keys: PlatformKeyService
  ) {}

  async createAccessToken(input: TokenRequest) {
    if (input.grant_type !== "client_credentials" || input.client_assertion_type !== CLIENT_ASSERTION_TYPE) {
      throw new AppError(400, "INVALID_TOKEN_REQUEST", "Unsupported OAuth client credentials request");
    }

    const untrustedClientId = parseUntrustedClientId(input.client_assertion);
    const tool = this.tools.requireByClientId(untrustedClientId);
    await this.assertions.verifyToolJwt(input.client_assertion, tool, `${this.config.appBaseUrl}/api/v1/lti/token`);

    const requestedScopes = input.scope?.split(" ").filter(Boolean) ?? [];
    const allowedScopes = requestedScopes.length ? requestedScopes : tool.scopes;
    const unauthorizedScope = allowedScopes.find((scope) => !tool.scopes.includes(scope));
    if (unauthorizedScope) {
      throw new AppError(403, "SCOPE_NOT_ALLOWED", "Requested scope is not allowed for this tool");
    }

    const accessToken = await this.keys.signJwt(
      {
        sub: tool.clientId,
        client_id: tool.clientId,
        scope: allowedScopes.join(" ")
      },
      this.config.ltiIssuer,
      "1h"
    );

    return {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: 3600,
      scope: allowedScopes.join(" ")
    };
  }
}

function parseUntrustedClientId(token: string) {
  const [, payload] = token.split(".");
  if (!payload) {
    throw new AppError(400, "INVALID_CLIENT_ASSERTION", "Client assertion is not a JWT");
  }

  const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { iss?: unknown };
  if (typeof decoded.iss !== "string") {
    throw new AppError(400, "INVALID_CLIENT_ASSERTION", "Client assertion is missing issuer");
  }
  return decoded.iss;
}
