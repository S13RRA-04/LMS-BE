import type { NextFunction, Request, Response } from "express";
import { hasAnyRole, type LmsRole } from "../auth/currentUser.js";
import { AppError } from "../errors/AppError.js";

export function requireRole(...roles: LmsRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.currentUser) {
      next(new AppError(401, "AUTH_REQUIRED", "Authentication is required"));
      return;
    }

    if (!hasAnyRole(req.currentUser, roles)) {
      next(new AppError(403, "FORBIDDEN", "User does not have permission to access this resource"));
      return;
    }

    next();
  };
}
