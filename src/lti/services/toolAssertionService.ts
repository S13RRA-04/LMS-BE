import { importJWK, jwtVerify, type JWTHeaderParameters } from "jose";
import { AppError } from "../../errors/AppError.js";
import type { RegisteredTool } from "../ltiTypes.js";

export class ToolAssertionService {
  async verifyToolJwt(token: string, tool: RegisteredTool, audience: string) {
    if (!tool.publicJwks?.keys.length) {
      throw new AppError(400, "TOOL_JWKS_MISSING", "Registered tool is missing public JWKS configuration");
    }

    const keySet = async (header: JWTHeaderParameters) => {
      const jwk = tool.publicJwks?.keys.find((candidate) => candidate.kid === header.kid);
      if (!jwk) {
        throw new AppError(401, "TOOL_KEY_NOT_FOUND", "No registered tool key matched the JWT header");
      }
      return importJWK(jwk, "RS256");
    };

    const result = await jwtVerify(token, keySet, {
      issuer: tool.clientId,
      subject: tool.clientId,
      audience
    });

    return result.payload;
  }
}
