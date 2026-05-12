# CETU LMS Product Model

CETU LMS should follow the same broad operating model as mature enterprise LMS products such as Absorb LMS, while remaining a CETU-specific implementation.

## Experience Boundaries

The product is organized around two primary experiences:

- Learner Experience: dashboard, catalog discovery, assigned training, course launch, transcript, resources, and progress.
- Admin Experience: course administration, user and department administration, enrollment management, reporting, portal settings, integrations, and audit review.

These are product boundaries, not just navigation labels. Backend APIs should preserve the same separation so learner workflows cannot accidentally inherit admin behavior.

## Core Domain Areas

- Portal: tenant-level LMS settings, branding, enabled learner features, support metadata.
- Departments: organizational structure used for branding, visibility, reporting, and admin scope.
- Users: Auth0-backed identities mapped to internal LMS users and roles.
- Courses: online courses, instructor-led training, curricula, bundles, and LTI-backed tools.
- Catalog: published course discovery with availability rules.
- Enrollments: assignment, self-enrollment, status, progress, completion, and expiry.
- Transcript: learner-facing and admin-facing record of course progress and outcomes.
- Reporting: role-scoped reporting over courses, users, departments, enrollments, and progress.
- Integrations: LTI 1.3, AGS, Deep Linking, object storage, Stream, and future content providers.

## Backend Rules

Every protected endpoint needs:

- Authenticated current-user context.
- Server-side role and permission checks.
- Request validation before service execution.
- A service boundary between route handling and domain behavior.
- Repository-backed persistence rather than direct database access from routes.
- Consistent error responses.

## Current Bootstrap

The first LMS API slice implements:

- `GET /api/v1/lms/learner/dashboard`
- `GET /api/v1/lms/learner/catalog`
- `GET /api/v1/lms/learner/transcript`
- `GET /api/v1/lms/admin/overview`
- `GET /api/v1/lms/admin/courses`
- `GET /api/v1/lms/admin/departments`

Development requests use `x-dev-user-*` headers only while Auth0 middleware is not yet wired. This path is intentionally disabled in production.

## Next Production Step

MongoDB is now the runtime repository for portal settings, departments, courses, enrollments, internal users, and audit logs. The API creates the required staging collections and indexes in the `PACT_V4` database with the `staging_` prefix in development and test.

Keycloak bearer tokens are verified at the backend boundary, normalized into CETU LMS roles, and linked to internal user records by Keycloak `sub`. Admin write operations record audit entries after successful mutation.

The next production step is adding richer transcript/event records and admin-facing audit log query endpoints.
