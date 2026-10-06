import * as Sentry from "@sentry/nextjs";
import { newCorrelationId, structuredEvent, type EventName } from '@vaultmaster/shared';
export function observe(event: EventName, fields: Record<string, unknown> = {}) {
  const payload = structuredEvent(event, {
    ...fields, component: 'web', requestId: newCorrelationId(),
  });
  console.info(JSON.stringify(payload));
  if (process.env.NEXT_PUBLIC_SENTRY_DSN && (payload.outcome === "failure" || payload.outcome === "degraded")) {
    Sentry.captureMessage("vaultmaster_event", { level: "error", extra: payload });
  }
}
