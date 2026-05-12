/// <reference types="@cloudflare/workers-types" />

declare module "cloudflare:node" {
  export function httpServerHandler(options: { port: number }): ExportedHandler;
}

declare module "cloudflare:workers" {
  export const env: Record<string, string>;
}
