import { structuredEvent } from '@vaultmaster/shared';
type LogLevel = 'info' | 'warn' | 'error';
function writeLog(level: LogLevel, event: string, context: Record<string, unknown> = {}) {
  const line = JSON.stringify({ timestamp: new Date().toISOString(), level,
    ...structuredEvent(event, { ...context, component: 'api' }) });
  if (level === 'error') console.error(line); else console.log(line);
}
export function logInfo(event: string, context?: Record<string, unknown>) { writeLog('info', event, context); }
export function logWarn(event: string, context?: Record<string, unknown>) { writeLog('warn', event, context); }
export function logError(event: string, _error: unknown, context?: Record<string, unknown>) { writeLog('error', event, context); }
