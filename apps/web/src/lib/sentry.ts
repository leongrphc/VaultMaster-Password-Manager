"use client";
import * as Sentry from "@sentry/nextjs";
import { structuredEvent, safeTelemetryEvent } from "@vaultmaster/shared";
let initialized = false;
export function initWebSentry() {
  if (initialized || !process.env.NEXT_PUBLIC_SENTRY_DSN) return;
  Sentry.init({ dsn: process.env.NEXT_PUBLIC_SENTRY_DSN, tracesSampleRate: 0,
    defaultIntegrations: false, sendDefaultPii: false,
    beforeBreadcrumb: () => null, beforeSend: safeTelemetryEvent });
  initialized = true;
}
export function captureWebException(_error: unknown, _context?: Record<string, unknown>) {
  void _error; void _context;
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;
  Sentry.captureMessage('vaultmaster_event', { level: 'error',
    extra: structuredEvent('client_error', { component: 'web', reason: 'internal' }) });
}
