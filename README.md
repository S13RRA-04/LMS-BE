# CETU LMS API

This is the backend API scaffold for the CETU LMS. The first implemented boundary is the LMS-side LTI 1.3 platform infrastructure used to launch tools such as PACT.

The LMS product model follows a mature enterprise LMS pattern similar to Absorb LMS: a distinct Learner Experience, a restricted Admin Experience, catalog/course launch flows, transcript tracking, reporting, role-scoped administration, portal configuration, and integration boundaries. See `docs/lms-product-model.md`.

## MongoDB

The API uses the `LMS` Mongo database by default. In development and test, collection names are prefixed with `staging_` unless `MONGO_COLLECTION_PREFIX` is explicitly set.

Current LMS collections:

- `staging_portal_settings`
- `staging_departments`
- `staging_courses`
- `staging_enrollments`
- `staging_users`
- `staging_audit_logs`
- `staging_lti_content_items`
- `staging_lti_line_items`
- `staging_lti_scores`

Run this after configuring `.env` to create collections and indexes:

```bash
npm run db:ensure
```

Run the collection/index check before deploying a new environment or after adding Mongo-backed features. The Worker runtime assumes required collections and indexes already exist.

## Keycloak OAuth

Protected LMS routes verify Keycloak bearer access tokens server-side using the realm JWKS endpoint.

Production Keycloak must be hosted on durable production infrastructure, not a
local Docker Desktop container or workstation Cloudflare Tunnel. See
`docs/keycloak-production.md` for the required production hosting shape and
cutover checklist.

Required Keycloak config:

- `KEYCLOAK_ISSUER`
- `KEYCLOAK_AUDIENCE`
- `KEYCLOAK_JWKS_URI`

Admin user management uses the Keycloak Admin API from the backend only. Configure a least-privilege service account or admin client with realm user-management and client role-mapping permissions:

- `KEYCLOAK_ADMIN_BASE_URL`, defaults to the issuer origin
- `KEYCLOAK_ADMIN_REALM`, defaults to the issuer realm
- `KEYCLOAK_ADMIN_TOKEN_REALM`, defaults to `KEYCLOAK_ADMIN_REALM`
- `KEYCLOAK_ADMIN_CLIENT_ID`
- `KEYCLOAK_ADMIN_CLIENT_SECRET` for client-credentials auth, or `KEYCLOAK_ADMIN_USERNAME` and `KEYCLOAK_ADMIN_PASSWORD` for password auth
- `KEYCLOAK_WEBHOOK_SECRET`, a shared secret sent by Keycloak event hooks in `x-keycloak-webhook-secret`

Role normalization maps Keycloak realm roles, client roles, and group names into one effective LMS role:

- `learner` or `lms_learner`
- `instructor` or `lms_instructor`
- `admin` or `lms_admin`

If Keycloak sends multiple matching roles, the LMS chooses one role by precedence:
`admin` > `instructor` > `learner`. Mongo user records store this as `role`
and also maintain a one-item `roles` array for compatibility with existing
authorization code.

Development headers are still available outside production when no bearer token is sent. Production requires a valid Keycloak bearer token.

On successful Keycloak verification, the API upserts an internal LMS user record linked by `keycloakSub`. Route authorization and audit logs use the internal user ID so future profile, enrollment, and reporting data are not coupled directly to raw identity-provider payloads.

Keycloak remains the source of truth for user identity. External Keycloak user changes should call `POST /api/v1/keycloak/events` with a Keycloak admin/user event payload containing either `userId`, `keycloakSub`, or `resourcePath: "users/{id}"`. The API authenticates the event with `x-keycloak-webhook-secret`, fetches the current user from Keycloak Admin API, and upserts Mongo. Delete events soft-delete the Mongo projection to preserve enrollment and audit references.

## Implemented LMS endpoints

Development-only current user headers:

- `x-dev-user-id`
- `x-dev-user-roles`, comma-separated: `learner`, `instructor`, `admin`
- `x-dev-user-email`
- `x-dev-user-name`
- `x-dev-department-id`

These headers are disabled in production. Production requires a valid Keycloak bearer token.

- `GET /api/v1/lms/learner/dashboard`
- `GET /api/v1/lms/learner/catalog`
- `GET /api/v1/lms/learner/transcript`
- `POST /api/v1/lms/courses/:courseId/launch`
- `GET /api/v1/lms/admin/overview`
- `GET /api/v1/lms/admin/courses`
- `POST /api/v1/lms/admin/courses`
- `PATCH /api/v1/lms/admin/courses/:courseId`
- `GET /api/v1/lms/admin/departments`
- `POST /api/v1/lms/admin/departments`
- `PATCH /api/v1/lms/admin/departments/:departmentId`
- `GET /api/v1/lms/admin/users`
- `POST /api/v1/lms/admin/users`
- `PATCH /api/v1/lms/admin/users/:userId`
- `DELETE /api/v1/lms/admin/users/:userId`
- `GET /api/v1/lms/admin/enrollments`
- `POST /api/v1/lms/admin/enrollments`
- `PATCH /api/v1/lms/admin/enrollments/:enrollmentId`
- `PATCH /api/v1/lms/admin/portal-settings`

Admins enroll users into courses through `/admin/enrollments`. Course enrollments
may include `cohortId`; learner dashboard and transcript responses include only
the courses enrolled for the signed-in user. LTI tool launch from the LMS is
gated by enrollment: `/courses/:courseId/launch` returns a server-signed LTI
form post only when the current user has an active enrollment for that course.
For PACT, the enrollment `cohortId` is emitted as the LTI context ID so the PACT
service can deliver cohort-specific modules, challenges, games, and scoreboards
after SSO. Squad assignment and squad-specific state are PACT-owned and must not
be stored or emitted by the LMS.

Successful admin writes create audit log records with actor, Keycloak subject, action, target, request ID, timestamp, and safe metadata.

## Implemented LTI endpoints

- `GET /api/v1/lti/jwks` exposes the LMS platform public signing keys.
- `GET /api/v1/lti/authorize` issues LTI 1.3 `id_token` launches by `form_post`.
- `POST /api/v1/lti/token` issues OAuth2 client-credentials access tokens for registered tools using `private_key_jwt`.
- `GET /api/v1/lti/ags/lineitems` lists AGS line items with read/write AGS scope.
- `POST /api/v1/lti/ags/lineitems` creates AGS line items with write AGS scope.
- `POST /api/v1/lti/ags/lineitems/:lineItemId/scores` accepts AGS scores with score scope.
- `POST /api/v1/lti/deep-linking/return` accepts a tool-signed Deep Linking response.

PACT should post individual learner module/game scores and learner-specific
derived grades to AGS. PACT team challenge scores should remain PACT-owned until
PACT maps them into learner gradebook outcomes.

## Required environment

Copy `.env.example` and provide real values:

- `APP_BASE_URL`: externally reachable LMS API URL.
- `LTI_ISSUER`: stable LMS LTI issuer URL.
- `LTI_PLATFORM_KID`: key ID advertised in JWKS.
- `LTI_PLATFORM_PRIVATE_KEY_PEM`: RSA private key used to sign platform JWTs.
- `LTI_TOOLS_JSON`: JSON array of registered tool records.
- `CORS_ORIGINS`: comma-separated frontend origins.

For Cloudflare-backed staging, see `docs/cloudflare-staging.md`. The public staging and production API entrypoints are deployed with Wrangler as Cloudflare Workers.

## Deployment paths

LMS backend is deployed as a Worker-native API. The Worker entrypoint reuses the service, repository, validation, Keycloak, LTI, audit-log, and Mongo-backed domain layers directly.

LMS backend has two Wrangler deployment paths:

| Target | Wrangler command | Runtime | Public API URL | Data prefix |
| --- | --- | --- | --- | --- |
| Staging | `npm run deploy:staging` | Cloudflare Worker API | `https://cetu-lms-api-staging.cetu.workers.dev` | `staging_` |
| Production | `npm run deploy:production` | Cloudflare Worker API | `https://lms-api.cetu.online` | none |

GitHub houses repository code only. Deployments are managed intentionally with Wrangler from an authenticated operator workstation or controlled deployment host. Production must be promoted intentionally after staging is verified and after production secrets, MongoDB, Keycloak, CORS, and PACT tool registration are configured.

## Wrangler deployments

Run build and tests before deploying:

```bash
npm run build
npm test
npm run deploy:staging
```

`npm run deploy:staging` deploys `wrangler.jsonc` environment `staging`. `npm run deploy:production` validates `.env.production`, builds, tests, dry-runs the Worker bundle, creates the production Worker if needed, uploads production secrets, redeploys, and runs health/JWKS smoke checks.

Runtime secrets such as `MONGO_URI`, `KEYCLOAK_ISSUER`, `KEYCLOAK_JWKS_URI`, `LTI_PLATFORM_KID`, and `LTI_PLATFORM_PRIVATE_KEY_PEM` must also be present as Cloudflare Worker secrets before the deployed Worker can serve protected routes.

Check which secret names exist:

```bash
npx wrangler secret list
```

Upload staging secrets from `.env.staging`:

```bash
npm run cloudflare:secrets:staging
```

Upload production secrets from `.env.production` without deploying:

```bash
npm run cloudflare:secrets:production
```

The secret upload script rejects localhost, `127.0.0.1`, and `example.com` values. For staging it requires staging Keycloak hosts; for production it rejects staging hosts.

Generate a new LMS LTI signing key when rotating or creating an environment:

```bash
npm run lti:key:generate -- staging-platform-key
```

Copy the generated `LTI_PLATFORM_KID` and `LTI_PLATFORM_PRIVATE_KEY_PEM` lines into the target backend env file. The private key is emitted with escaped `\n` sequences because the backend converts them back to PEM newlines at runtime.

Example tool registration:

```json
[
  {
    "clientId": "pact-tool",
    "name": "PACT",
    "deploymentIds": ["pact-course-deployment"],
    "redirectUris": ["https://pact-api.example.com/api/v1/lti/launch"],
    "deepLinkRedirectUris": ["https://pact-api.example.com/api/v1/lti/deep-link"],
    "targetLinkUri": "https://pact-api.example.com/launch",
    "publicJwks": { "keys": [] },
    "scopes": [
      "https://purl.imsglobal.org/spec/lti-ags/scope/lineitem",
      "https://purl.imsglobal.org/spec/lti-ags/scope/lineitem.readonly",
      "https://purl.imsglobal.org/spec/lti-ags/scope/result.readonly",
      "https://purl.imsglobal.org/spec/lti-ags/scope/score"
    ]
  }
]
```

## Architecture notes

Worker routes validate request shapes and delegate to services. LMS records, audit logs, LTI content items, line items, and AGS scores use Mongo-backed repositories.

The LMS/PACT service contract is documented in `docs/lms-pact-boundary.md`. LMS owns Keycloak-authenticated users, enrollments, launch authorization, LTI platform behavior, and official AGS grade records. PACT owns validated launch sessions, PACT content/progress/scores, squads, and AGS publish attempts.

Use `npm run staging:pact-tool -- -PactApiBaseUrl https://<pact-api-origin>` to refresh staging `LTI_TOOLS_JSON` with PACT launch URL, Deep Linking URL, and the public JWKS from PACT.

Before production, connect launch authorization to the authenticated LMS user/session and expand accepted Deep Linking records into the final course authoring workflow.
