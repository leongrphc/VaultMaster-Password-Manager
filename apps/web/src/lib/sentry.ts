"use client";

import * as Sentry from "@sentry/nextjs";

let initialized = false;

export function initWebSentry() {
  if (initialized || !process.env.NEXT_PUBLIC_SENTRY_DSN) {
    return;
  }

  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0,
  });

  initialized = true;
}

export function captureWebException(error: unknown, context?: Record<string, unknown>) {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) {
    return;
  }

  Sentry.captureException(error, {
    extra: context,
  });
}
