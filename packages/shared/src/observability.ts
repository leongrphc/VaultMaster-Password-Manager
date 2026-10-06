// Fail closed: no arbitrary text, paths, exceptions or stable identities cross
// this boundary. IDs are accepted only when minted in this process/module.
const issued = new Map<string, number>();
export function newCorrelationId(): string {
  const id = (globalThis as unknown as { crypto: { randomUUID(): string } }).crypto.randomUUID();
  issued.set(id, Date.now());
  if (issued.size > 4096) issued.delete(issued.keys().next().value!);
  return id;
}
export const eventNames = ['http_request', 'validation_error', 'unhandled_error',
  'audit_log_write_failed', 'server_started', 'client_error', 'sync_result',
  'backup_result', 'database_probe', 'health_alert', 'health_recovered'] as const;
export type EventName = typeof eventNames[number];
export function structuredEvent(name: unknown, input: Record<string, unknown> = {}) {
  const event: Record<string, string | number> = {
    schemaVersion: 1, event: eventNames.includes(name as EventName) ? name as string : 'client_error',
  };
  const enums: Record<string, readonly string[]> = {
    component: ['api', 'web', 'extension', 'monitor'],
    operation: ['api', 'database', 'sync', 'backup', 'offline', 'client'],
    outcome: ['success', 'failure', 'cancelled', 'degraded'],
    reason: ['network', 'http', 'invalid_response', 'decrypt', 'storage', 'timeout', 'internal'],
    method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'],
    alert: ['api_unavailable', 'database_unavailable', 'api_errors', 'sync_errors', 'backup_errors', 'backup_stale'],
  };
  for (const [key, values] of Object.entries(enums)) {
    if (typeof input[key] === 'string' && values.includes(input[key] as string)) event[key] = input[key] as string;
  }
  for (const key of ['statusCode', 'durationMs']) {
    const value = input[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= (key === 'statusCode' ? 599 : 300000)) event[key] = Math.round(value);
  }
  if (typeof input.requestId === 'string') {
    const time = issued.get(input.requestId);
    if (time !== undefined && Date.now() - time < 300000) event.requestId = input.requestId;
  }
  return event;
}
// Optional telemetry SDKs must rebuild, never mutate/blacklist the original event.
export function safeTelemetryEvent(event: { message?: string; extra?: Record<string, unknown> }) {
  if (event.message !== 'vaultmaster_event' || !event.extra) return null;
  return { type: undefined, message: 'vaultmaster_event', level: 'error' as const,
    extra: structuredEvent(event.extra.event, event.extra) };
}
