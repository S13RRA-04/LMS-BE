import type { NextFunction, Request, Response } from "express";
import { AppError } from "../errors/AppError.js";
import type { CurrentUser, LmsRole } from "../auth/currentUser.js";
import type { AppConfig } from "../config/config.js";
import { KeycloakAuthService } from "../auth/keycloakAuthService.js";
import { getMongoDb } from "../db/mongo.js";
import { MongoUserRepository } from "../users/mongoUserRepository.js";

const roles = new Set<LmsRole>(["learner", "instructor", "admin"]);

export function currentUser(config: AppConfig) {
  const keycloak = new KeycloakAuthService(config);

  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const bearer = extractBearer(req.header("authorization"));
      if (bearer) {
        const verified = await keycloak.verifyAccessToken(bearer);
        const internalUser = await new MongoUserRepository(await getMongoDb(config), config).upsertFromKeycloak({
          keycloakSub: verified.keycloakSub ?? verified.id,
          email: verified.email,
          name: verified.name,
          role: verified.role,
          roles: verified.roles,
          permissions: verified.permissions,
          departmentId: verified.departmentId
        });
        req.currentUser = {
          id: internalUser.id,
          keycloakSub: internalUser.keycloakSub,
          email: internalUser.email,
          name: internalUser.name,
          role: internalUser.role,
          roles: internalUser.roles,
          permissions: internalUser.permissions,
          departmentId: internalUser.departmentId
        };
        next();
        return;
      }

      if (config.env === "production") {
        throw new AppError(401, "AUTH_REQUIRED", "Authentication is required");
      }

      const userId = req.header("x-dev-user-id");
      const requestedRoles = parseRoles(req.header("x-dev-user-roles"));
      const role = primaryRole(requestedRoles);

      if (!userId) {
        throw new AppError(401, "AUTH_REQUIRED", "Authentication is required");
      }

      req.currentUser = {
        id: userId,
        keycloakSub: undefined,
        email: req.header("x-dev-user-email") ?? undefined,
        name: req.header("x-dev-user-name") ?? undefined,
        departmentId: req.header("x-dev-department-id") ?? undefined,
        role,
        roles: [role],
        permissions: requestedRoles
      };
      next();
    } catch (error) {
      next(error);
    }
  };
}

function primaryRole(requestedRoles: LmsRole[]): LmsRole {
  if (requestedRoles.includes("admin")) return "admin";
  if (requestedRoles.includes("instructor")) return "instructor";
  return "learner";
}

function extractBearer(header?: string) {
  if (!header?.startsWith("Bearer ")) {
    return undefined;
  }
  return header.slice("Bearer ".length);
}

function parseRoles(value?: string) {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((role) => role.trim())
    .filter((role): role is LmsRole => roles.has(role as LmsRole));
}

declare global {
  namespace Express {
    interface Request {
      currentUser?: CurrentUser;
    }
  }
}
