import { LTI_CLAIMS } from "../ltiConstants.js";
import type { DeepLinkContentItem } from "../ltiTypes.js";
import type { ToolRegistrationRepository } from "../repositories/toolRegistrationRepository.js";
import type { ToolAssertionService } from "./toolAssertionService.js";
import type { AppConfig } from "../../config/config.js";
import { AppError } from "../../errors/AppError.js";

export class DeepLinkingService {
  constructor(
    private readonly config: AppConfig,
    private readonly tools: ToolRegistrationRepository,
    private readonly assertions: ToolAssertionService
  ) {}

  async acceptDeepLinkResponse(idToken: string) {
    const clientId = parseUntrustedIssuer(idToken);
    const tool = this.tools.requireByClientId(clientId);
    const payload = await this.assertions.verifyToolJwt(
      idToken,
      tool,
      `${this.config.appBaseUrl}/api/v1/lti/deep-linking/return`
    );

    if (payload[LTI_CLAIMS.messageType] !== "LtiDeepLinkingResponse") {
      throw new AppError(400, "INVALID_DEEP_LINK_RESPONSE", "JWT is not an LTI Deep Linking response");
    }

    const items = payload[LTI_CLAIMS.contentItems];
    if (!Array.isArray(items)) {
      throw new AppError(400, "INVALID_DEEP_LINK_ITEMS", "Deep Linking response did not include content items");
    }

    return {
      accepted: items as DeepLinkContentItem[],
      count: items.length
    };
  }
}

function parseUntrustedIssuer(token: string) {
  const [, payload] = token.split(".");
  if (!payload) {
    throw new AppError(400, "INVALID_DEEP_LINK_TOKEN", "Deep Linking response is not a JWT");
  }
  const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { iss?: unknown };
  if (typeof decoded.iss !== "string") {
    throw new AppError(400, "INVALID_DEEP_LINK_TOKEN", "Deep Linking response is missing issuer");
  }
  return decoded.iss;
}
