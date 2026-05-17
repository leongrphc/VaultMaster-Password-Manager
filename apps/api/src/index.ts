import express, { type Express, type Request } from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import { env } from "./config/env.js";
import { errorHandler } from "./middleware/error-handler.js";
import {
  requestContextMiddleware,
  requestLoggingMiddleware,
} from "./middleware/request-context.js";
import authRoutes from "./routes/auth.routes.js";
import vaultRoutes from "./routes/vault.routes.js";
import foldersRoutes from "./routes/folders.routes.js";
import healthRoutes from "./routes/health.routes.js";
import twoFactorRoutes from "./routes/two-factor.routes.js";
import devicesRoutes from "./routes/devices.routes.js";
import auditRoutes from "./routes/audit.routes.js";
import { logInfo } from "./utils/logger.js";
import { initSentry } from "./utils/sentry.js";

initSentry();

function getNormalizedAuthEmail(req: Request): string | null {
  const email = req.body?.email;
  if (typeof email !== "string") {
    return null;
  }

  const normalized = email.toLowerCase().trim();
  return normalized || null;
}

function getAuthThrottleKey(req: Request): string {
  const normalizedEmail = getNormalizedAuthEmail(req);
  if (normalizedEmail) {
    return `email:${normalizedEmail}`;
  }

  return `ip:${req.ip ?? "unknown"}`;
}

export function createApp(): Express {
  const app = express();

  app.set("trust proxy", 1);
  app.use(requestContextMiddleware);
  app.use(requestLoggingMiddleware);
  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
  app.use(express.json({ limit: "10mb" }));
  app.use(cookieParser());

  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: "Çok fazla istek, lütfen bekleyin" },
  });

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: getAuthThrottleKey,
    message: {
      success: false,
      error: "Bu hesap için çok fazla kimlik doğrulama denemesi yapıldı. Lütfen bekleyin",
    },
  });

  const twoFactorSensitiveLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: getAuthThrottleKey,
    message: {
      success: false,
      error: "Çok fazla 2FA doğrulama denemesi yapıldı. Lütfen bekleyin",
    },
  });

  const accountSensitiveLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      error: "Çok fazla hassas hesap işlemi denemesi yapıldı. Lütfen bekleyin",
    },
  });

  const refreshLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      error: "Çok fazla oturum yenileme denemesi yapıldı. Lütfen bekleyin",
    },
  });

  app.use("/api", limiter);
  app.use("/api/auth/login", authLimiter);
  app.use("/api/auth/register", authLimiter);
  app.use("/api/auth/2fa/verify", twoFactorSensitiveLimiter);
  app.use("/api/auth/2fa/disable", accountSensitiveLimiter);
  app.use("/api/auth/2fa/recovery-codes/regenerate", accountSensitiveLimiter);
  app.use("/api/auth/change-password", accountSensitiveLimiter);
  app.use("/api/auth/delete-account", accountSensitiveLimiter);
  app.use("/api/auth/refresh", refreshLimiter);

  app.use("/api/health", healthRoutes);
  app.use("/api/auth", authRoutes);
  app.use("/api/auth/2fa", twoFactorRoutes);
  app.use("/api/devices", devicesRoutes);
  app.use("/api/audit-events", auditRoutes);
  app.use("/api/vault", vaultRoutes);
  app.use("/api/folders", foldersRoutes);

  app.use(errorHandler);

  return app;
}

export function startServer() {
  const app = createApp();
  return app.listen(env.API_PORT, () => {
    logInfo("server_started", {
      port: env.API_PORT,
      environment: env.NODE_ENV,
      corsOrigins: env.CORS_ORIGIN,
    });
  });
}

if (process.env.NODE_ENV !== "test") {
  startServer();
}
