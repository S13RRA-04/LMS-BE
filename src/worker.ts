import { httpServerHandler } from "cloudflare:node";
import { createApp } from "./app.js";
import { loadConfig } from "./config/config.js";
import { createLogger } from "./logging/logger.js";

const port = 3000;
let expressHandler: ExportedHandler | undefined;

function getExpressHandler(workerEnv: Record<string, string>) {
  if (!expressHandler) {
    const config = loadConfig(workerEnv);
    const logger = createLogger(config);
    const app = createApp(config, logger);
    app.listen(port);
    expressHandler = httpServerHandler({ port });
  }

  return expressHandler;
}

export default {
  fetch(request, workerEnv, context) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return Response.json({ ok: true, runtime: "cloudflare-workers" });
    }

    try {
      const handler = getExpressHandler(workerEnv as Record<string, string>);
      if (!handler.fetch) {
        return Response.json({ error: { code: "WORKER_HANDLER_UNAVAILABLE", message: "Worker handler unavailable" } }, { status: 500 });
      }

      return handler.fetch(request, workerEnv as never, context);
    } catch (error) {
      console.error("Worker initialization failed", error);
      return Response.json(
        { error: { code: "WORKER_CONFIG_ERROR", message: "LMS API Worker is missing required staging configuration" } },
        { status: 503 }
      );
    }
  }
} satisfies ExportedHandler;
