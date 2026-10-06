import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Never let the focused import browser check fall back to a deployment .env.
const database = process.env.VAULTMASTER_TEST_DATABASE_URL;
if (!database) throw new Error("VAULTMASTER_TEST_DATABASE_URL is required; use a disposable migrated database");
const runtime = mkdtempSync(join(tmpdir(), "vm-import-browser-"));
const cwd = join(runtime, "runtime", "work");
mkdirSync(cwd, { recursive: true });
process.on("exit", () => rmSync(runtime, { recursive: true, force: true }));
const start = `delete process.env.SENTRY_DSN; const api = await import(${JSON.stringify(pathToFileURL(resolve("apps/api/dist/index.js")).href)}); api.startServer();`;
export default defineConfig({
  ...base,
  testMatch: "export-import.spec.ts",
  retries: 0,
  use: { ...base.use, trace: "off", screenshot: "off" },
  webServer: [
    {
      command: `node --input-type=module -e '${start.replace(/'/g, "'\\''")}'`,
      cwd,
      url: "http://localhost:4000/api/health",
      reuseExistingServer: false,
      env: {
        NODE_ENV: "test", DATABASE_URL: database,
        DATABASE_DIRECT_URL: process.env.VAULTMASTER_TEST_DATABASE_DIRECT_URL || database,
        JWT_SECRET: "synthetic-import-browser-access-secret",
        JWT_REFRESH_SECRET: "synthetic-import-browser-refresh-secret",
        APP_ENCRYPTION_KEY: "Iqgdnj6zTOno1qTzP6+46sh4Vhvs13bWVeLD5TbLWXA=",
        API_PORT: "4000", CORS_ORIGIN: "http://localhost:3000",
      },
    },
    {
      command: "pnpm --filter @vaultmaster/web start",
      url: "http://localhost:3000",
      reuseExistingServer: false,
      env: { NODE_ENV: "production", SENTRY_DSN: "", NEXT_PUBLIC_SENTRY_DSN: "" },
    },
  ],
});
