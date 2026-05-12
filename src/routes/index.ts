import { Router } from "express";
import type { AppConfig } from "../config/config.js";
import type { AppLogger } from "../logging/logger.js";
import { createKeycloakRouter } from "./keycloakRoutes.js";
import { createLtiRouter } from "./ltiRoutes.js";
import { createLmsRouter } from "./lmsRoutes.js";

export function createApiRouter(config: AppConfig, logger: AppLogger) {
  const router = Router();
  router.use("/keycloak", createKeycloakRouter(config));
  router.use("/lms", createLmsRouter(config));
  router.use("/lti", createLtiRouter(config, logger));
  return router;
}
