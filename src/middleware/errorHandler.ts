import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { isAppError } from "../errors/AppError.js";
import type { AppLogger } from "../logging/logger.js";

export function errorHandler(logger: AppLogger): ErrorRequestHandler {
  return (error, req, res, _next) => {
    if (error instanceof ZodError) {
      res.status(400).json({ error: { code: "VALIDATION_FAILED", message: "Invalid request", requestId: req.requestId } });
      return;
    }

    if (isAppError(error)) {
      res.status(error.statusCode).json({ error: { code: error.code, message: error.message, requestId: req.requestId } });
      return;
    }

    logger.error({ err: error, requestId: req.requestId }, "Unhandled request error");
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Internal server error", requestId: req.requestId } });
  };
}
