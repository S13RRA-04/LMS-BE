import { createPrivateKey } from "node:crypto";
import { exportJWK, importPKCS8, importSPKI, SignJWT, type JWTPayload, type KeyLike } from "jose";
import type { AppConfig } from "../../config/config.js";

export class PlatformKeyService {
  private readonly privateKeyPromise: Promise<KeyLike>;

  constructor(private readonly config: AppConfig) {
    this.privateKeyPromise = importPKCS8(config.ltiPlatformPrivateKeyPem, "RS256");
  }

  async jwks() {
    const publicKey = createPrivateKey(this.config.ltiPlatformPrivateKeyPem).export({ type: "spki", format: "pem" });
    const jwk = await exportJWK(await importSPKI(publicKey.toString(), "RS256"));
    return { keys: [{ ...jwk, kid: this.config.ltiPlatformKid, alg: "RS256", use: "sig" }] };
  }

  async signJwt(payload: JWTPayload, audience: string | string[], expiresIn = "5m") {
    return new SignJWT(payload)
      .setProtectedHeader({ alg: "RS256", kid: this.config.ltiPlatformKid, typ: "JWT" })
      .setIssuer(this.config.ltiIssuer)
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime(expiresIn)
      .sign(await this.privateKeyPromise);
  }
}
