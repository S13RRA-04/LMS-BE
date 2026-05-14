# Keycloak production hosting

`keycloak.cetu.online` must be backed by a production Keycloak deployment, not a
developer workstation, Docker Desktop, or a local `start-dev` container exposed
through Cloudflare Tunnel.

The local scripts under `scripts/start-local-infra.ps1` exist only for
development recovery and local integration testing.

## Required production shape

Run Keycloak on a stable production host or managed container platform with:

- Keycloak started with `start`, not `start-dev`.
- A durable external database supported by Keycloak, such as PostgreSQL.
- Persistent backups for the Keycloak database and realm exports.
- Explicit hostname configuration for `https://keycloak.cetu.online`.
- Reverse-proxy headers configured for the Cloudflare-facing proxy path.
- TLS terminated at Cloudflare or the upstream load balancer, with Keycloak
  configured to trust only the intended proxy headers.
- Health checks and restart policy owned by the production host, not by an
  operator desktop session.
- A Cloudflare DNS route or named Cloudflare Tunnel that points to the
  production host, not `127.0.0.1` on this workstation.

Cloudflare Workers and Pages are not the right runtime for Keycloak. Keycloak is
a long-running stateful Java service and needs its own production compute and
database layer. Cloudflare may sit in front for DNS, TLS, WAF, and Tunnel
connectivity.

## Minimum Keycloak runtime settings

Use environment variables or `keycloak.conf` values equivalent to:

```text
KC_HOSTNAME=https://keycloak.cetu.online
KC_HOSTNAME_STRICT=true
KC_PROXY_HEADERS=xforwarded
KC_HTTP_ENABLED=true
KC_DB=postgres
KC_DB_URL=jdbc:postgresql://<postgres-host>:5432/<database>
KC_DB_USERNAME=<keycloak-db-user>
KC_DB_PASSWORD=<keycloak-db-password>
```

If TLS is terminated directly by Keycloak instead of a proxy, disable plain HTTP
and configure Keycloak certificates according to the official server guide.

## LMS and frontend dependencies

After the production Keycloak host is live, these values must continue to point
at the canonical issuer:

- `LMS-BE`: `KEYCLOAK_ISSUER=https://keycloak.cetu.online/realms/cetu`
- `LMS-BE`: `KEYCLOAK_JWKS_URI=https://keycloak.cetu.online/realms/cetu/protocol/openid-connect/certs`
- `LMS-FE`: `VITE_KEYCLOAK_URL=https://keycloak.cetu.online`
- `LMS-FE`: `VITE_KEYCLOAK_REALM=cetu`
- `LMS-FE`: `VITE_KEYCLOAK_CLIENT_ID=cetu-lms-web`

Do not switch production LMS or PACT config to a staging Keycloak realm or a
localhost issuer.

## Cutover checklist

1. Provision the production Keycloak database and user.
2. Export the current `cetu` realm from the temporary instance.
3. Import the realm into the production Keycloak deployment.
4. Confirm the `cetu-lms-web` client has production redirect URIs, including
   `https://lms.cetu.online/*`.
5. Confirm LMS API audience/client role mappings are present.
6. Configure the Keycloak admin integration client used by `LMS-BE`.
7. Route `keycloak.cetu.online` to the production Keycloak host through
   Cloudflare.
8. Verify:

```powershell
Invoke-RestMethod "https://keycloak.cetu.online/realms/cetu/.well-known/openid-configuration"
Invoke-RestMethod "https://keycloak.cetu.online/realms/cetu/protocol/openid-connect/certs"
```

9. Upload or verify LMS Worker secrets, then redeploy `LMS-BE`.
10. Log in through `https://lms.cetu.online` and confirm the LMS API accepts the
    issued access token.

## References

- Keycloak production configuration:
  https://www.keycloak.org/server/configuration-production
- Keycloak hostname configuration:
  https://www.keycloak.org/server/hostname
- Keycloak reverse proxy configuration:
  https://www.keycloak.org/server/reverseproxy
- Cloudflare Tunnel documentation:
  https://developers.cloudflare.com/tunnel/
