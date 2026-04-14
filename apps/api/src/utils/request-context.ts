import { randomUUID } from "node:crypto";
import type { Request } from "express";

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      requestStartedAt?: number;
    }
  }
}

export function resolveRequestId(value: string | string[] | undefined): string {
  const candidate = Array.isArray(value) ? value[0] : value;
  const normalized = candidate?.trim();

  if (normalized) {
    return normalized.slice(0, 128);
  }

  return randomUUID();
}

export function getRequestId(req: Request): string | null {
  return req.requestId ?? null;
}

export function getRequestIp(req: Request): string | null {
  const forwardedFor = req.headers["x-forwarded-for"];
  if (typeof forwardedFor === "string" && forwardedFor.length > 0) {
    return forwardedFor.split(",")[0]?.trim() ?? null;
  }

  return req.ip || null;
}

export function getRequestUserAgent(req: Request): string | null {
  return req.headers["user-agent"]?.slice(0, 255) ?? null;
}

export function inferDeviceType(userAgent: string | null): string {
  if (!userAgent) {
    return "unknown";
  }

  const ua = userAgent.toLowerCase();
  if (/iphone|ipad|android|mobile/.test(ua)) {
    return "mobile";
  }

  return "web";
}

export function buildRequestLogContext(req: Request) {
  return {
    requestId: getRequestId(req),
    method: req.method,
    path: req.originalUrl,
    userId: req.user?.userId ?? null,
    ipAddress: getRequestIp(req),
    userAgent: getRequestUserAgent(req),
  };
}
