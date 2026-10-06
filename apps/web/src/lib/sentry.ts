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
    // Range URLs contain a password-derived prefix. Never retain them as
    // breadcrumbs on unrelated errors when optional telemetry is enabled.
    beforeBreadcrumb(breadcrumb) {
      const url = breadcrumb.data?.url;
      if (typeof url === "string" && url.startsWith("https://api.pwnedpasswords.com/")) return null;
      return breadcrumb;
    },
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
