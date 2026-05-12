# Cloudflare staging

The LMS API is an Express/MongoDB Node service. It should not be deployed to Cloudflare Pages, and it should not be pushed into Workers without a deliberate adapter change for Express and MongoDB connectivity.

Use one of these staging patterns:

1. Run the API on a Node-capable staging host and proxy it through Cloudflare DNS.
2. Run the API on a controlled staging machine and expose it through a named Cloudflare Tunnel.

## Required API settings

Copy `.env.staging.example` to `.env.staging` and replace every placeholder with staging values.

Use:

- `NODE_ENV=production` so development auth headers are disabled.
- `MONGO_COLLECTION_PREFIX=staging_` to keep staging data isolated in MongoDB.
- `APP_BASE_URL` and `LTI_ISSUER` set to the public staging API origin.
- `CORS_ORIGINS` set to the Cloudflare Pages staging frontend origin.

Do not reuse production private keys or production Mongo collections for staging.

## Cloudflare Tunnel outline

After authenticating `cloudflared` on the staging machine:

```powershell
cloudflared tunnel login
cloudflared tunnel create cetu-lms-api-staging
cloudflared tunnel route dns cetu-lms-api-staging lms-api-staging.example.com
```

Create the tunnel config outside the repo, pointing at the local API:

```yaml
tunnel: cetu-lms-api-staging
credentials-file: C:\Users\<user>\.cloudflared\<tunnel-id>.json

ingress:
  - hostname: lms-api-staging.example.com
    service: http://127.0.0.1:4000
  - service: http_status:404
```

Then start the API with `.env.staging`, run `npm run db:ensure`, and run the tunnel as a service for persistent staging access.
