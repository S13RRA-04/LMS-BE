import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { AppConfig } from "../config/config.js";
import { AppError } from "../errors/AppError.js";
import type { CurrentUser, LmsRole } from "./currentUser.js";

type KeycloakPayload = JWTPayload & {
  email?: string;
  name?: string;
  preferred_username?: string;
  realm_access?: { roles?: string[] };
  resource_access?: Record<string, { roles?: string[] }>;
  authorization?: { permissions?: Array<{ rsname?: string; scopes?: string[] }> };
  department_id?: string;
  groups?: string[];
};

const roleMap: Record<string, LmsRole> = {
  learner: "learner",
  lms_learner: "learner",
  instructor: "instructor",
  lms_instructor: "instructor",
  admin: "admin",
  lms_admin: "admin"
};

export class KeycloakAuthService {
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;

  constructor(private readonly config: AppConfig) {
    this.jwks = createRemoteJWKSet(new URL(config.keycloakJwksUri));
  }

  async verifyAccessToken(token: string): Promise<CurrentUser> {
    const { payload } = await jwtVerify<KeycloakPayload>(token, this.jwks, {
      issuer: this.config.keycloakIssuer,
      audience: this.config.keycloakAudience
    });

    const id = requireSubject(payload.sub);
    const rawRoles = collectRoles(payload, this.config.keycloakAudience);
    const roles = normalizeRoles(rawRoles);
    const permissions = normalizePermissions(payload);

    if (!roles.length) {
      roles.push("learner");
    }

    return {
      id,
      keycloakSub: id,
      email: payload.email,
      name: payload.name ?? payload.preferred_username,
      departmentId: payload.department_id,
      roles,
      permissions
    };
  }
}

function requireSubject(sub: string | undefined) {
  if (!sub) {
    throw new AppError(401, "INVALID_ACCESS_TOKEN", "Access token is missing subject");
  }
  return sub;
}

function collectRoles(payload: KeycloakPayload, audience: string) {
  return [
    ...(payload.realm_access?.roles ?? []),
    ...(payload.resource_access?.[audience]?.roles ?? []),
    ...(payload.groups ?? []).map((group) => group.split("/").filter(Boolean).at(-1) ?? group)
  ];
}

function normalizeRoles(rawRoles: string[]) {
  return [...new Set(rawRoles.map((role) => roleMap[role.toLowerCase()]).filter((role): role is LmsRole => Boolean(role)))];
}

function normalizePermissions(payload: KeycloakPayload) {
  const umaPermissions =
    payload.authorization?.permissions?.flatMap((permission) =>
      (permission.scopes ?? []).map((scope) => `${permission.rsname ?? "resource"}:${scope}`)
    ) ?? [];

  return [...new Set([...umaPermissions, ...collectRoles(payload, "")])];
}
