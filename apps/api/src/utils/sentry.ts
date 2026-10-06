import * as Sentry from "@sentry/node";
import { structuredEvent, safeTelemetryEvent } from "@vaultmaster/shared";
import { env } from "../config/env.js";
let initialized = false;
export function initSentry() {
  if (initialized || !env.SENTRY_DSN) return;
  Sentry.init({ dsn: env.SENTRY_DSN, tracesSampleRate: 0,
    defaultIntegrations: false, sendDefaultPii: false,
    beforeBreadcrumb: () => null, beforeSend: safeTelemetryEvent });
  initialized = true;
}
export function captureApiException(_error: unknown, context?: Record<string, unknown>) {
  if (!env.SENTRY_DSN) return;
  Sentry.captureMessage('vaultmaster_event', { level: 'error',
    extra: structuredEvent('unhandled_error', { ...context, component: 'api', reason: 'internal' }) });
}
