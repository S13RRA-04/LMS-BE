import { AppError } from "../../errors/AppError.js";
import { LTI_CLAIMS, LTI_SCOPES } from "../ltiConstants.js";
import type { LaunchContextRepository } from "../repositories/launchContextRepository.js";
import type { ToolRegistrationRepository } from "../repositories/toolRegistrationRepository.js";
import type { PlatformKeyService } from "./platformKeyService.js";
import type { AppConfig } from "../../config/config.js";

export type AuthorizationRequest = {
  client_id: string;
  redirect_uri: string;
  response_type: string;
  response_mode: string;
  scope: string;
  nonce: string;
  state?: string;
  login_hint: string;
  lti_message_hint: string;
  prompt?: string;
};

export class LtiLaunchService {
  constructor(
    private readonly config: AppConfig,
    private readonly tools: ToolRegistrationRepository,
    private readonly launchContexts: LaunchContextRepository,
    private readonly keys: PlatformKeyService
  ) {}

  async createLaunchForm(request: AuthorizationRequest) {
    if (request.response_type !== "id_token" || request.response_mode !== "form_post" || request.scope !== "openid") {
      throw new AppError(400, "INVALID_OIDC_REQUEST", "Unsupported LTI OIDC authorization request");
    }

    const tool = this.tools.requireByClientId(request.client_id);
    if (!tool.redirectUris.includes(request.redirect_uri)) {
      throw new AppError(400, "INVALID_REDIRECT_URI", "Redirect URI is not registered for this tool");
    }

    const context = this.launchContexts.requireByHint(request.lti_message_hint);
    if (!tool.deploymentIds.includes(context.deploymentId)) {
      throw new AppError(403, "DEPLOYMENT_NOT_ALLOWED", "Tool deployment is not allowed for this launch context");
    }

    const idToken = await this.keys.signJwt(
      {
        sub: context.userId,
        nonce: request.nonce,
        name: context.userName,
        email: context.userEmail,
        [LTI_CLAIMS.messageType]: context.messageType,
        [LTI_CLAIMS.version]: "1.3.0",
        [LTI_CLAIMS.deploymentId]: context.deploymentId,
        [LTI_CLAIMS.targetLinkUri]: tool.targetLinkUri,
        [LTI_CLAIMS.resourceLink]: { id: context.resourceLinkId },
        [LTI_CLAIMS.roles]: context.roles,
        [LTI_CLAIMS.context]: { id: context.contextId, title: context.contextTitle },
        [LTI_CLAIMS.lis]: { person_sourcedid: context.userId },
        [LTI_CLAIMS.agsEndpoint]: {
          scope: [LTI_SCOPES.lineItem, LTI_SCOPES.lineItemReadonly, LTI_SCOPES.resultReadonly, LTI_SCOPES.score],
          lineitems: `${this.config.appBaseUrl}/api/v1/lti/ags/lineitems`
        },
        [LTI_CLAIMS.deepLinkingSettings]: {
          deep_link_return_url: `${this.config.appBaseUrl}/api/v1/lti/deep-linking/return`,
          accept_types: ["ltiResourceLink"],
          accept_presentation_document_targets: ["iframe", "window"],
          accept_multiple: true,
          auto_create: false
        }
      },
      request.client_id
    );

    return renderFormPost(request.redirect_uri, {
      id_token: idToken,
      ...(request.state ? { state: request.state } : {})
    });
  }
}

function renderFormPost(action: string, fields: Record<string, string>) {
  const inputs = Object.entries(fields)
    .map(([name, value]) => `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}" />`)
    .join("");

  return `<!doctype html><html><head><meta charset="utf-8"><title>LTI Launch</title></head><body><form method="post" action="${escapeHtml(action)}">${inputs}</form><script>document.forms[0].submit();</script></body></html>`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
