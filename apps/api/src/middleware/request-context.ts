import type { NextFunction, Request, Response } from "express";
import { logInfo } from "../utils/logger.js";
import { buildRequestLogContext, resolveRequestId } from "../utils/request-context.js";

export const REQUEST_ID_HEADER = "x-request-id";

export function requestContextMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  req.requestId = resolveRequestId(req.headers[REQUEST_ID_HEADER]);
  req.requestStartedAt = Date.now();
  res.setHeader(REQUEST_ID_HEADER, req.requestId);
  next();
}

export function requestLoggingMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  res.on("finish", () => {
    logInfo("http_request", {
      ...buildRequestLogContext(req),
      statusCode: res.statusCode,
      durationMs: req.requestStartedAt
        ? Date.now() - req.requestStartedAt
        : undefined,
    });
  });

  next();
}
