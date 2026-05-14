# LMS and PACT Boundary

The LMS is the LTI platform and system of record for LMS identity, enrollment, launch authorization, line items, AGS score receiving, and official grade records.

PACT is the LTI tool and system of record for PACT content, launch-derived PACT user projections, PACT sessions, cohort/squad behavior, progress, attempts, and PACT score calculation.

## Launch Contract

LMS launches PACT only after authenticating the LMS user and verifying launch permission.

Canonical PACT tool registration:

```json
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
```

Deep-linked content items may target:

- `https://pact-api.example.com/launch/module`
- `https://pact-api.example.com/launch/challenge`
- `https://pact-api.example.com/launch/game`
- `https://pact-api.example.com/launch/assessment`

PACT validates signed LMS launch tokens server-side before creating a PACT user/session. Required claims include issuer, audience, signature, expiration, deployment ID, LTI version `1.3.0`, message type, context ID, target link URI, and resource link ID for resource launches.

PACT accepts only target link URIs on its configured `APP_BASE_URL` origin and known launch/deep-link paths. Legacy `/lti/launch` and `/lti/deep-link` paths are temporarily accepted for compatibility and should be removed after deployed registrations are confirmed migrated.

## Frontend Boundary

LMS-FE authenticates with Keycloak and calls LMS-BE only. It requests launch HTML from LMS-BE and submits the server-signed LTI form.

LMS operators can use the admin `Refresh AGS Context` shortcut to issue a server-signed PACT resource launch for a selected course/cohort. PACT stores the resulting non-secret AGS launch context so durable backend retries can acquire fresh score tokens after process restarts.

PACT-FE does not use Keycloak. It relies on the PACT session created by PACT-BE after a valid LTI launch and calls PACT-BE only.

## Score Contract

PACT calculates PACT-specific learner scores. LMS receives official learner grade records through AGS.

PACT records each score submission in PACT storage and publishes to LMS AGS when a line item URL is available. PACT stores non-secret AGS launch context and requests short-lived AGS score tokens server-side from the LMS token endpoint using its registered tool private key. Identical score replays that were already published are not posted to LMS again. Changed scores are posted again.

PACT records AGS publish attempts in `pactAgsPublishAttempts` with safe metadata only:

- course, cohort, squad, user, and content IDs
- line item URL
- score, max score, and progress percent
- publish status
- safe error code/message for failures

PACT must not persist AGS access tokens.

When durable retry attempts reach the configured maximum, PACT records `retry_exhausted`, logs an operator-facing warning, and surfaces the exhausted attempts in PACT-FE diagnostics for manual inspection and retry.

## Data Ownership

Do not share Mongo collections between LMS and PACT. The services communicate through LTI launch, Deep Linking, AGS, and explicit API contracts only.

LMS-owned data includes LMS users, courses, enrollments, transcripts, LTI tool registrations, line items, received scores, and LMS audit logs.

PACT-owned data includes PACT users, PACT sessions, PACT content, squads, attempts, progress, PACT scores, AGS publish attempts, and PACT audit records.
