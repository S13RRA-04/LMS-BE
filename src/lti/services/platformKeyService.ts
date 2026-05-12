import { createPublicKey, type KeyObject } from "node:crypto";
import { exportJWK, importPKCS8, SignJWT, type JWK, type JWTPayload, type KeyLike } from "jose";
import type { AppConfig } from "../../config/config.js";

export class PlatformKeyService {
  private readonly privateKeyPromise: Promise<KeyLike>;

  constructor(private readonly config: AppConfig) {
    this.privateKeyPromise = importPKCS8(config.ltiPlatformPrivateKeyPem, "RS256", { extractable: true });
  }

  async jwks() {
    const publicKey = createPublicKey((await this.privateKeyPromise) as KeyObject);
    const jwk = publicRsaJwk(await exportJWK(publicKey));
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

function publicRsaJwk(jwk: JWK): JWK {
  if (jwk.kty !== "RSA" || !jwk.n || !jwk.e) {
    throw new Error("LTI platform signing key must be an RSA private key");
  }

  return {
    kty: "RSA",
    n: jwk.n,
    e: jwk.e
  };
}
