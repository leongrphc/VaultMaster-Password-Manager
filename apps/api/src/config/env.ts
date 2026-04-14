import dotenv from "dotenv";
import { resolve } from "path";
import { z } from "zod";

dotenv.config({ path: resolve(process.cwd(), "../../.env") });
dotenv.config({ path: resolve(process.cwd(), ".env") });

function normalizeDatabaseUrl(databaseUrl: string) {
  try {
    const url = new URL(databaseUrl);
    const isSupabasePooler =
      url.protocol.startsWith("postgres") &&
      url.hostname.endsWith(".pooler.supabase.com");

    if (!isSupabasePooler) {
      return databaseUrl;
    }

    if (!url.searchParams.has("pgbouncer")) {
      url.searchParams.set("pgbouncer", "true");
    }

    if (!url.searchParams.has("connection_limit")) {
      url.searchParams.set("connection_limit", "1");
    }

    if (!url.searchParams.has("sslmode")) {
      url.searchParams.set("sslmode", "require");
    }

    return url.toString();
  } catch {
    return databaseUrl;
  }
}

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL gerekli"),
  DATABASE_DIRECT_URL: z.string().min(1, "DATABASE_DIRECT_URL gerekli").optional(),
  JWT_SECRET: z.string().min(32, "JWT_SECRET en az 32 karakter olmalı"),
  JWT_REFRESH_SECRET: z
    .string()
    .min(32, "JWT_REFRESH_SECRET en az 32 karakter olmalı"),
  JWT_EXPIRES_IN: z.string().min(1).default("15m"),
  JWT_REFRESH_EXPIRES_IN: z.string().min(1).default("7d"),
  API_PORT: z.coerce.number().int().positive().default(4000),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  CORS_ORIGIN: z.string().min(1).default("http://localhost:3000"),
  APP_ENCRYPTION_KEY: z.string().min(1, "APP_ENCRYPTION_KEY gerekli"),
  SENTRY_DSN: z.string().min(1).optional(),
});

export function parseEnv(raw: NodeJS.ProcessEnv) {
  const parsed = envSchema.parse(raw);
  const keyLength = Buffer.from(parsed.APP_ENCRYPTION_KEY, "base64").length;

  if (keyLength !== 32) {
    throw new Error("APP_ENCRYPTION_KEY base64 decode edildiğinde 32 byte olmalı");
  }

  return {
    ...parsed,
    DATABASE_URL: normalizeDatabaseUrl(parsed.DATABASE_URL),
    CORS_ORIGIN: parsed.CORS_ORIGIN.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  };
}

export const env = parseEnv(process.env);
