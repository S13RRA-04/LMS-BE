import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import type { AppConfig } from "../config/config.js";
import { getMongoDb } from "../db/mongo.js";
import { AppError } from "../errors/AppError.js";
import { KeycloakAdminClient } from "../integrations/keycloak/keycloakAdminClient.js";
import { MongoUserRepository } from "../users/mongoUserRepository.js";
import { KeycloakUserSyncService } from "../users/keycloakUserSyncService.js";

const keycloakEventSchema = z
  .object({
    operationType: z.string().optional(),
    resourceType: z.string().optional(),
    resourcePath: z.string().optional(),
    userId: z.string().optional(),
    keycloakSub: z.string().optional()
  })
  .passthrough();

export function createKeycloakRouter(config: AppConfig) {
  const router = Router();

  router.post("/events", async (req, res, next) => {
    try {
      requireWebhookSecret(config, req.header("x-keycloak-webhook-secret"));
      const event = keycloakEventSchema.parse(req.body);
      const result = await services(config).then((service) => service.syncFromEvent(event));
      res.status(202).json({ ok: true, action: result.action, keycloakSub: result.keycloakSub });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

async function services(config: AppConfig) {
  const db = await getMongoDb(config);
  return new KeycloakUserSyncService(new KeycloakAdminClient(config), new MongoUserRepository(db, config));
}

function requireWebhookSecret(config: AppConfig, suppliedSecret: string | undefined) {
  if (!config.keycloakWebhookSecret) {
    throw new AppError(503, "KEYCLOAK_WEBHOOK_NOT_CONFIGURED", "Keycloak user sync webhook is not configured");
  }

  if (!suppliedSecret || !timingSafeEqual(config.keycloakWebhookSecret, suppliedSecret)) {
    throw new AppError(401, "KEYCLOAK_WEBHOOK_UNAUTHORIZED", "Keycloak webhook authentication failed");
  }
}

function timingSafeEqual(expected: string, actual: string) {
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  return expectedBuffer.length === actualBuffer.length && crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}
