# Cloudflare staging

The LMS API staging runtime is a Cloudflare Worker deployed with Wrangler.

The old Express container and Cloudflare Tunnel staging model has been removed.
Staging API traffic should use the Worker entrypoint in `src/worker.ts`.

## Required settings

Copy `.env.staging.example` to `.env.staging` and replace every placeholder
with staging values.

Use:

- `NODE_ENV=production` so development auth headers are disabled in deployed environments.
- `MONGO_COLLECTION_PREFIX=staging_` to keep staging data isolated in MongoDB.
- `APP_BASE_URL` and `LTI_ISSUER` set to `https://cetu-lms-api-staging.cetu.workers.dev`.
- `CORS_ORIGINS` set to the Cloudflare Pages staging frontend origin.

Do not reuse production private keys or production Mongo collections for staging.

## Worker deployment

Upload staging Worker secrets before deploying:

```powershell
npm run cloudflare:secrets:staging
```

Then deploy:

```powershell
npm run build
npm test
npm run db:ensure
npm run deploy:staging
```

Run the LTI staging smoke after deployment:

```powershell
npm run staging:smoke:lti
```
