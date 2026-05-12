import { createPrivateKey } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { jwtVerify, importSPKI, type JWTPayload } from "jose";
import type { AppConfig } from "../../config/config.js";
import { AppError } from "../../errors/AppError.js";

export function ltiAccessToken(config: AppConfig) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const header = req.header("authorization");
      if (!header?.startsWith("Bearer ")) {
        throw new AppError(401, "MISSING_BEARER_TOKEN", "Missing bearer access token");
      }

      const token = header.slice("Bearer ".length);
      const publicKey = await importSPKI(
        cryptoPublicKeyPem(config.ltiPlatformPrivateKeyPem.replace(/\\n/g, "\n")),
        "RS256"
      );
      const { payload } = await jwtVerify(token, publicKey, {
        issuer: config.ltiIssuer,
        audience: config.ltiIssuer
      });

      req.ltiAccessToken = {
        clientId: requireString(payload.client_id, "client_id"),
        scopes: parseScopes(payload)
      };
      next();
    } catch (error) {
      next(error);
    }
  };
}

function parseScopes(payload: JWTPayload) {
  return typeof payload.scope === "string" ? payload.scope.split(" ").filter(Boolean) : [];
}

function requireString(value: unknown, field: string) {
  if (typeof value !== "string") {
    throw new AppError(401, "INVALID_ACCESS_TOKEN", `Access token is missing ${field}`);
  }
  return value;
}

function cryptoPublicKeyPem(privateKeyPem: string) {
  return createPrivateKey(privateKeyPem).export({ type: "spki", format: "pem" }).toString();
}

declare global {
  namespace Express {
    interface Request {
      ltiAccessToken?: {
        clientId: string;
        scopes: string[];
      };
    }
  }
}
