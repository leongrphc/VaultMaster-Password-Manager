import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { logError, logWarn } from "../utils/logger.js";
import { buildRequestLogContext, getRequestId } from "../utils/request-context.js";
import { captureApiException } from "../utils/sentry.js";

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof ZodError) {
    const messages = err.errors.map((e) => `${e.path.join(".")}: ${e.message}`);
    logWarn("validation_error", {
      ...buildRequestLogContext(req),
      statusCode: 400,
      details: messages,
    });
    res.status(400).json({
      success: false,
      error: "Validasyon hatası",
      details: messages,
      requestId: getRequestId(req),
    });
    return;
  }

  const requestContext = {
    ...buildRequestLogContext(req),
    statusCode: 500,
  };

  captureApiException(err, requestContext);
  logError("unhandled_error", err, requestContext);

  res.status(500).json({
    success: false,
    error: process.env.NODE_ENV === "production"
      ? "Sunucu hatası"
      : err.message,
    requestId: getRequestId(req),
  });
}
