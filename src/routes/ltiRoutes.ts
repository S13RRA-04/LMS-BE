import { Router } from "express";
import type { AppConfig } from "../config/config.js";
import { AppError } from "../errors/AppError.js";
import { AgsService } from "../lti/services/agsService.js";
import { DeepLinkingService } from "../lti/services/deepLinkingService.js";
import { LtiLaunchService } from "../lti/services/ltiLaunchService.js";
import { LtiTokenService } from "../lti/services/ltiTokenService.js";
import { PlatformKeyService } from "../lti/services/platformKeyService.js";
import { ToolAssertionService } from "../lti/services/toolAssertionService.js";
import { LaunchContextRepository } from "../lti/repositories/launchContextRepository.js";
import { MongoLineItemRepository } from "../lti/repositories/mongoLineItemRepository.js";
import { ToolRegistrationRepository } from "../lti/repositories/toolRegistrationRepository.js";
import { getMongoDb } from "../db/mongo.js";
import { ltiAccessToken } from "../lti/middleware/ltiAccessToken.js";
import {
  authorizationQuerySchema,
  deepLinkReturnBodySchema,
  lineItemBodySchema,
  scoreBodySchema,
  tokenBodySchema
} from "../lti/validators/ltiSchemas.js";
import type { AppLogger } from "../logging/logger.js";

export function createLtiRouter(config: AppConfig, _logger: AppLogger) {
  const router = Router();
  const toolRepo = new ToolRegistrationRepository(config.registeredTools);
  const contextRepo = new LaunchContextRepository();
  const keyService = new PlatformKeyService(config);
  const assertionService = new ToolAssertionService();
  const launchService = new LtiLaunchService(config, toolRepo, contextRepo, keyService);
  const tokenService = new LtiTokenService(config, toolRepo, assertionService, keyService);

  router.get("/jwks", async (_req, res, next) => {
    try {
      res.status(200).json(await keyService.jwks());
    } catch (error) {
      next(error);
    }
  });

  router.get("/authorize", async (req, res, next) => {
    try {
      const html = await launchService.createLaunchForm(authorizationQuerySchema.parse(req.query));
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.status(200).send(html);
    } catch (error) {
      next(error);
    }
  });

  router.post("/token", async (req, res, next) => {
    try {
      res.status(200).json(await tokenService.createAccessToken(tokenBodySchema.parse(req.body)));
    } catch (error) {
      next(error);
    }
  });

  router.post("/deep-linking/return", async (req, res, next) => {
    try {
      const body = deepLinkReturnBodySchema.parse(req.body);
      const lineItems = new MongoLineItemRepository(await getMongoDb(config), config);
      res.status(200).json(await new DeepLinkingService(config, toolRepo, assertionService, lineItems).acceptDeepLinkResponse(body.JWT ?? body.id_token ?? ""));
    } catch (error) {
      next(error);
    }
  });

  router.get("/ags/lineitems", ltiAccessToken(config), async (req, res, next) => {
    try {
      const agsService = new AgsService(new MongoLineItemRepository(await getMongoDb(config), config));
      res.status(200).json(await agsService.listLineItems(requireScopes(req)));
    } catch (error) {
      next(error);
    }
  });

  router.post("/ags/lineitems", ltiAccessToken(config), async (req, res, next) => {
    try {
      const agsService = new AgsService(new MongoLineItemRepository(await getMongoDb(config), config));
      res.status(201).json(await agsService.createLineItem(requireScopes(req), lineItemBodySchema.parse(req.body)));
    } catch (error) {
      next(error);
    }
  });

  router.post("/ags/lineitems/:lineItemId/scores", ltiAccessToken(config), async (req, res, next) => {
    try {
      res.status(201).json(
        await new AgsService(new MongoLineItemRepository(await getMongoDb(config), config)).submitScore(
          requireScopes(req),
          req.params.lineItemId,
          scoreBodySchema.parse(req.body)
        )
      );
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function requireScopes(req: Express.Request) {
  if (!req.ltiAccessToken) {
    throw new AppError(401, "MISSING_LTI_CONTEXT", "Missing LTI access token context");
  }
  return req.ltiAccessToken.scopes;
}
