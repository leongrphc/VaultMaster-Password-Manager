type LogLevel = "info" | "warn" | "error";

interface LogContext {
  requestId?: string | null;
  method?: string;
  path?: string;
  statusCode?: number;
  durationMs?: number;
  userId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
  [key: string]: unknown;
}

function writeLog(level: LogLevel, message: string, context: LogContext = {}) {
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...context,
  };

  const line = JSON.stringify(payload);
  if (level === "error") {
    console.error(line);
    return;
  }

  console.log(line);
}

export function logInfo(message: string, context?: LogContext) {
  writeLog("info", message, context);
}

export function logWarn(message: string, context?: LogContext) {
  writeLog("warn", message, context);
}

export function logError(message: string, error: unknown, context: LogContext = {}) {
  const normalizedError =
    error instanceof Error
      ? {
          name: error.name,
          message: error.message,
          stack: error.stack,
        }
      : {
          name: "UnknownError",
          message: typeof error === "string" ? error : "Bilinmeyen hata",
        };

  writeLog("error", message, {
    ...context,
    error: normalizedError,
  });
}
