import * as Sentry from "@sentry/node";
import { env } from "../config/env.js";

let initialized = false;

export function initSentry() {
  if (initialized || !env.SENTRY_DSN) {
    return;
  }

  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    tracesSampleRate: 0,
  });

  initialized = true;
}

export function captureApiException(error: unknown, context?: Record<string, unknown>) {
  if (!env.SENTRY_DSN) {
    return;
  }

  Sentry.captureException(error, {
    extra: context,
  });
}
