import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";

export function requestId(req: Request, res: Response, next: NextFunction) {
  const id = req.header("x-request-id") ?? crypto.randomUUID();
  res.setHeader("x-request-id", id);
  req.requestId = id;
  next();
}

declare global {
  namespace Express {
    interface Request {
      requestId: string;
    }
  }
}
