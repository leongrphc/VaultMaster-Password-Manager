import { healthAlerts } from "../utils/health-alerts.js";
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
    const operation = req.path.startsWith("/api/backups") ? "backup" :
      req.path.startsWith("/api/vault") || req.path.startsWith("/api/folders") ? "sync" : "api";
    if (!req.path.startsWith("/api/health")) healthAlerts.record(operation, res.statusCode);
    logInfo(operation === "backup" ? "backup_result" : operation === "sync" ? "sync_result" : "http_request", {
      operation, outcome: res.statusCode < 400 ? "success" : "failure",
      ...buildRequestLogContext(req),
      statusCode: res.statusCode,
      durationMs: req.requestStartedAt
        ? Date.now() - req.requestStartedAt
        : undefined,
    });
  });

  next();
}
