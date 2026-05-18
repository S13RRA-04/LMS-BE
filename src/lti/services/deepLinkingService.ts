import { LTI_CLAIMS } from "../ltiConstants.js";
import type { DeepLinkContentItem } from "../ltiTypes.js";
import type { MongoLineItemRepository } from "../repositories/mongoLineItemRepository.js";
import type { ToolRegistrationRepository } from "../repositories/toolRegistrationRepository.js";
import type { ToolAssertionService } from "./toolAssertionService.js";
import type { AppConfig } from "../../config/config.js";
import { AppError } from "../../errors/AppError.js";

export class DeepLinkingService {
  constructor(
    private readonly config: AppConfig,
    private readonly tools: ToolRegistrationRepository,
    private readonly assertions: ToolAssertionService,
    private readonly lineItems: MongoLineItemRepository
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

    const context = parseDeepLinkData(payload.data);
    const accepted = await Promise.all(
      (items as DeepLinkContentItem[]).map(async (item) => {
        const cohortId = cohortIdForDeepLinkedItem(item, context.cohortId);
        const lineItem = await this.lineItems.upsertFromDeepLink(item, { cohortId });
        return this.lineItems.saveDeepLinkedContent({
          toolClientId: tool.clientId,
          item,
          lineItem,
          courseId: context.courseId,
          cohortId
        });
      })
    );

    return { accepted, count: accepted.length };
  }
}

function cohortIdForDeepLinkedItem(item: DeepLinkContentItem, cohortId: string | undefined) {
  const tag = item.lineItem?.tag ?? item.type;
  return tag === "challenge" || tag === "workshop" || item.custom?.content_id ? cohortId : undefined;
}

function parseDeepLinkData(value: unknown) {
  if (typeof value !== "string") {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as { courseId?: unknown; cohortId?: unknown };
    return {
      courseId: typeof parsed.courseId === "string" ? parsed.courseId : undefined,
      cohortId: typeof parsed.cohortId === "string" ? parsed.cohortId : undefined
    };
  } catch {
    return {};
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
