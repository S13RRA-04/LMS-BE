import crypto from "node:crypto";
import { AppError } from "../../errors/AppError.js";
import { LTI_CLAIMS, LTI_SCOPES } from "../ltiConstants.js";
import type { LaunchContextRepository } from "../repositories/launchContextRepository.js";
import type { ToolRegistrationRepository } from "../repositories/toolRegistrationRepository.js";
import type { PlatformKeyService } from "./platformKeyService.js";
import type { AppConfig } from "../../config/config.js";
import type { CurrentUser } from "../../auth/currentUser.js";
import type { Course, Enrollment } from "../../lms/lmsTypes.js";

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

  async createCourseLaunchForm(input: { course: Course; enrollment: Enrollment; user: CurrentUser }) {
    if (input.course.type !== "lti_tool" || !input.course.ltiToolClientId) {
      throw new AppError(400, "COURSE_NOT_LTI_TOOL", "Course does not have an LTI tool launch configured");
    }

    const tool = this.tools.requireByClientId(input.course.ltiToolClientId);
    const deploymentId = tool.deploymentIds[0];
    const redirectUri = tool.redirectUris[0];

    if (!deploymentId || !redirectUri) {
      throw new AppError(400, "LTI_TOOL_MISCONFIGURED", "LTI tool is missing deployment or redirect configuration");
    }

    const contextId = input.enrollment.cohortId ?? input.course.id;
    const idToken = await this.keys.signJwt(
      {
        sub: input.user.id,
        nonce: crypto.randomUUID(),
        name: input.user.name,
        email: input.user.email,
        [LTI_CLAIMS.messageType]: "LtiResourceLinkRequest",
        [LTI_CLAIMS.version]: "1.3.0",
        [LTI_CLAIMS.deploymentId]: deploymentId,
        [LTI_CLAIMS.targetLinkUri]: tool.targetLinkUri,
        [LTI_CLAIMS.resourceLink]: { id: input.course.id, title: input.course.title },
        [LTI_CLAIMS.roles]: [ltiRoleFor(input.user.role)],
        [LTI_CLAIMS.context]: { id: contextId, title: input.course.title },
        [LTI_CLAIMS.lis]: { person_sourcedid: input.user.id },
        [LTI_CLAIMS.agsEndpoint]: {
          scope: [LTI_SCOPES.lineItem, LTI_SCOPES.lineItemReadonly, LTI_SCOPES.resultReadonly, LTI_SCOPES.score],
          lineitems: `${this.config.appBaseUrl}/api/v1/lti/ags/lineitems`
        }
      },
      tool.clientId
    );

    return renderFormPost(redirectUri, { id_token: idToken });
  }

  async createDeepLinkingLaunchForm(input: { course: Course; user: CurrentUser; cohortId?: string }) {
    if (input.course.type !== "lti_tool" || !input.course.ltiToolClientId) {
      throw new AppError(400, "COURSE_NOT_LTI_TOOL", "Course does not have an LTI tool configured for Deep Linking");
    }

    const tool = this.tools.requireByClientId(input.course.ltiToolClientId);
    const deploymentId = tool.deploymentIds[0];
    const redirectUri = tool.deepLinkRedirectUris[0] ?? tool.redirectUris[0];

    if (!deploymentId || !redirectUri) {
      throw new AppError(400, "LTI_TOOL_MISCONFIGURED", "LTI tool is missing deployment or redirect configuration");
    }

    const contextId = input.cohortId ?? input.course.id;
    const idToken = await this.keys.signJwt(
      {
        sub: input.user.id,
        nonce: crypto.randomUUID(),
        name: input.user.name,
        email: input.user.email,
        [LTI_CLAIMS.messageType]: "LtiDeepLinkingRequest",
        [LTI_CLAIMS.version]: "1.3.0",
        [LTI_CLAIMS.deploymentId]: deploymentId,
        [LTI_CLAIMS.targetLinkUri]: tool.targetLinkUri,
        [LTI_CLAIMS.roles]: [ltiRoleFor(input.user.role)],
        [LTI_CLAIMS.context]: { id: contextId, title: input.course.title },
        [LTI_CLAIMS.lis]: { person_sourcedid: input.user.id },
        [LTI_CLAIMS.deepLinkingSettings]: {
          deep_link_return_url: `${this.config.appBaseUrl}/api/v1/lti/deep-linking/return`,
          accept_types: ["ltiResourceLink"],
          accept_presentation_document_targets: ["iframe", "window"],
          accept_multiple: true,
          auto_create: false,
          data: JSON.stringify({
            courseId: input.course.id,
            cohortId: contextId,
            requestedBy: input.user.id
          })
        },
        [LTI_CLAIMS.agsEndpoint]: {
          scope: [LTI_SCOPES.lineItem, LTI_SCOPES.lineItemReadonly, LTI_SCOPES.resultReadonly, LTI_SCOPES.score],
          lineitems: `${this.config.appBaseUrl}/api/v1/lti/ags/lineitems`
        },
        [LTI_CLAIMS.custom]: {
          course_id: input.course.id,
          cohort_id: contextId
        }
      },
      tool.clientId
    );

    return renderFormPost(redirectUri, { id_token: idToken });
  }
}

function ltiRoleFor(role: CurrentUser["role"]) {
  if (role === "learner") return "http://purl.imsglobal.org/vocab/lis/v2/membership#Learner";
  return "http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor";
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
