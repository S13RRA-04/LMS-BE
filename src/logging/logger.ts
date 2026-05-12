import pino from "pino";
import type { AppConfig } from "../config/config.js";

export type AppLogger = pino.Logger;

export function createLogger(config: AppConfig): AppLogger {
  return pino({
    level: config.env === "production" ? "info" : "debug",
    redact: ["req.headers.authorization", "req.body.client_assertion", "req.body.id_token"]
  });
}
