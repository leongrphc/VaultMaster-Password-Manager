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
  if ((err as Error & { code?: string }).code === "REAUTH_REQUIRED") {
    res.status(403).json({ success: false, error: "Yeniden doğrulama gerekli.", code: "REAUTH_REQUIRED" }); return;
  }
  if ((err as Error & { type?: string }).type === "entity.too.large") {
    res.status(413).json({ success: false, error: "Dosya veya istek boyut sınırını aşıyor.", requestId: getRequestId(req) });
    return;
  }
  if (err instanceof ZodError) {
    const messages = err.errors.map((e) => `${e.path.join(".")}: ${e.message}`);
    logWarn("validation_error", {
      ...buildRequestLogContext(req),
      statusCode: 400,
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
    error: "Sunucu hatası",
    requestId: getRequestId(req),
  });
}
