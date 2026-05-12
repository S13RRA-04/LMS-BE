# CETU LMS API

This is the backend API scaffold for the CETU LMS. The first implemented boundary is the LMS-side LTI 1.3 platform infrastructure used to launch tools such as PACT.

The LMS product model follows a mature enterprise LMS pattern similar to Absorb LMS: a distinct Learner Experience, a restricted Admin Experience, catalog/course launch flows, transcript tracking, reporting, role-scoped administration, portal configuration, and integration boundaries. See `docs/lms-product-model.md`.

## MongoDB

The API uses the `CETU` Mongo database by default. In development and test, collection names are prefixed with `staging_` unless `MONGO_COLLECTION_PREFIX` is explicitly set.

Current LMS collections:

- `staging_portal_settings`
- `staging_departments`
- `staging_courses`
- `staging_enrollments`
- `staging_users`
- `staging_audit_logs`

Run this after configuring `.env` to create collections and indexes:

```bash
npm run db:ensure
```

The same collection-creation check also runs at API startup.

## Keycloak OAuth

Protected LMS routes verify Keycloak bearer access tokens server-side using the realm JWKS endpoint.

Required Keycloak config:

- `KEYCLOAK_ISSUER`
- `KEYCLOAK_AUDIENCE`
- `KEYCLOAK_JWKS_URI`

Role normalization maps Keycloak realm roles, client roles, and group names into LMS roles:

- `learner` or `lms_learner`
- `instructor` or `lms_instructor`
- `admin` or `lms_admin`

Development headers are still available outside production when no bearer token is sent. Production requires a valid Keycloak bearer token.

On successful Keycloak verification, the API upserts an internal LMS user record linked by `keycloakSub`. Route authorization and audit logs use the internal user ID so future profile, enrollment, and reporting data are not coupled directly to raw identity-provider payloads.

## Implemented LMS endpoints

Development-only current user headers:

- `x-dev-user-id`
- `x-dev-user-roles`, comma-separated: `learner`, `instructor`, `admin`
- `x-dev-user-email`
- `x-dev-user-name`
- `x-dev-department-id`

These headers are disabled in production until Auth0 middleware is wired.

- `GET /api/v1/lms/learner/dashboard`
- `GET /api/v1/lms/learner/catalog`
- `GET /api/v1/lms/learner/transcript`
- `GET /api/v1/lms/admin/overview`
- `GET /api/v1/lms/admin/courses`
- `POST /api/v1/lms/admin/courses`
- `PATCH /api/v1/lms/admin/courses/:courseId`
- `GET /api/v1/lms/admin/departments`
- `POST /api/v1/lms/admin/departments`
- `PATCH /api/v1/lms/admin/departments/:departmentId`
- `POST /api/v1/lms/admin/enrollments`
- `PATCH /api/v1/lms/admin/enrollments/:enrollmentId`
- `PATCH /api/v1/lms/admin/portal-settings`

Successful admin writes create audit log records with actor, Keycloak subject, action, target, request ID, timestamp, and safe metadata.

## Implemented LTI endpoints

- `GET /api/v1/lti/jwks` exposes the LMS platform public signing keys.
- `GET /api/v1/lti/authorize` issues LTI 1.3 `id_token` launches by `form_post`.
- `POST /api/v1/lti/token` issues OAuth2 client-credentials access tokens for registered tools using `private_key_jwt`.
- `GET /api/v1/lti/ags/lineitems` lists AGS line items with read/write AGS scope.
- `POST /api/v1/lti/ags/lineitems` creates AGS line items with write AGS scope.
- `POST /api/v1/lti/ags/lineitems/:lineItemId/scores` accepts AGS scores with score scope.
- `POST /api/v1/lti/deep-linking/return` accepts a tool-signed Deep Linking response.

## Required environment

Copy `.env.example` and provide real values:

- `APP_BASE_URL`: externally reachable LMS API URL.
- `LTI_ISSUER`: stable LMS LTI issuer URL.
- `LTI_PLATFORM_KID`: key ID advertised in JWKS.
- `LTI_PLATFORM_PRIVATE_KEY_PEM`: RSA private key used to sign platform JWTs.
- `LTI_TOOLS_JSON`: JSON array of registered tool records.
- `CORS_ORIGINS`: comma-separated frontend origins.

For Cloudflare-backed staging, see `docs/cloudflare-staging.md`. The API remains a Node/Express service and should be hosted on a Node-capable staging host or exposed through a Cloudflare Tunnel, not deployed directly to Pages.

Example tool registration:

```json
[
  {
    "clientId": "pact-tool",
    "name": "PACT",
    "deploymentIds": ["pact-course-deployment"],
    "redirectUris": ["https://pact.example.com/lti/launch"],
    "targetLinkUri": "https://pact.example.com/lti/launch",
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

Routes validate request shapes and delegate to services. LTI tool registration, launch context, and line item storage are currently repository classes so MongoDB-backed implementations can replace the in-memory bootstrap without changing controllers.

Before production, replace in-memory repositories with MongoDB repositories, connect launch authorization to the authenticated LMS user/session, and persist Deep Linking selections as course content records.
