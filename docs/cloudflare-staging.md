# Cloudflare staging

The LMS API is an Express/MongoDB Node service. It should not be deployed to Cloudflare Pages, and the Cloudflare Worker entrypoint is a legacy compatibility shim, not the staging API.

Use one of these staging patterns:

1. Run the API on a Node-capable staging host and proxy it through Cloudflare DNS.
2. Run the API on a controlled staging machine and expose it through a named Cloudflare Tunnel.

For local PACT/LMS development, a tunnel only makes sense when PACT or an LTI callback needs a public HTTPS LMS API origin. If the LMS backend and PACT backend are running on the same private machine or network, point PACT directly at the LMS API instead of adding an external tunnel hop.

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

Then start the real API with `.env.staging`, run `npm run db:ensure`, and run the tunnel as a service for persistent staging access.

## Real API deployment

Build and run the Express/Mongo API as a Node container for staging:

```powershell
npm run deploy:staging
```

This uses `Dockerfile`, loads `.env.staging`, and starts `node dist/server.js` on the local staging host. Put Cloudflare DNS or Cloudflare Tunnel in front of that container. Do not use `npm run deploy:worker:legacy` for staging API traffic; that deploys the static Worker shim and does not exercise Mongo-backed routes.

## Local PACT/LTI tunnel

Start the LMS API locally first:

```powershell
npm run dev
```

In a second terminal, start a quick Cloudflare Tunnel:

```powershell
npm run local:tunnel:lms-api
```

The script:

- exposes `http://127.0.0.1:4000` through a temporary `https://*.trycloudflare.com` URL;
- updates the public LMS URL keys in `..\Environment\.env` without printing the file contents;
- sets `LMS_API_PUBLIC_URL`, `PACT_LMS_API_URL`, `APP_BASE_URL`, and `LTI_ISSUER` to the tunnel URL;
- writes tunnel logs under `.logs\`.

Use a named tunnel for stable callback URLs once DNS is configured:

```powershell
npm run local:tunnel:lms-api -- -ConfigPath C:\secure\cloudflared\cetu-lms-api.yml -PublicUrl https://lms-api-staging.example.com
```

Do not commit tunnel credential files or Cloudflare API tokens. Keep named tunnel configuration and credentials outside the repository.
