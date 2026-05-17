import dotenv from "dotenv";
import { resolve } from "node:path";

const TEST_EMAIL_DOMAIN = "example.integration.test";
const DEFAULT_AUTH_HASH = "integration-auth-hash";

dotenv.config({ path: resolve(process.cwd(), ".env") });
dotenv.config({ path: resolve(process.cwd(), "apps/api/.env") });

process.env.NODE_ENV = "test";
process.env.JWT_SECRET ||= "a".repeat(32);
process.env.JWT_REFRESH_SECRET ||= "b".repeat(32);
process.env.JWT_EXPIRES_IN ||= "15m";
process.env.JWT_REFRESH_EXPIRES_IN ||= "7d";
process.env.API_PORT ||= "0";
process.env.CORS_ORIGIN ||= "http://localhost:3000";
process.env.APP_ENCRYPTION_KEY ||= "Iqgdnj6zTOno1qTzP6+46sh4Vhvs13bWVeLD5TbLWXA=";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for API integration tests");
}

let appModulePromise;
let prismaModulePromise;

async function loadAppModule() {
  appModulePromise ??= import("../dist/index.js");
  return appModulePromise;
}

async function loadPrismaModule() {
  prismaModulePromise ??= import("../dist/config/prisma.js");
  return prismaModulePromise;
}

export function uniqueEmail(prefix = "user") {
  const suffix = `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${suffix}@${TEST_EMAIL_DOMAIN}`;
}

export async function cleanupIntegrationUsers() {
  const { prisma } = await loadPrismaModule();
  await prisma.user.deleteMany({
    where: {
      email: {
        endsWith: `@${TEST_EMAIL_DOMAIN}`,
      },
    },
  });
}

export async function disconnectPrisma() {
  const { prisma } = await loadPrismaModule();
  await prisma.$disconnect();
}

export async function startTestServer() {
  const { createApp } = await loadAppModule();
  const server = createApp().listen(0);
  await new Promise((resolve) => server.once("listening", resolve));

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Unable to determine test server address");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    server,
  };
}

export async function stopTestServer(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

export async function request(baseUrl, path, options = {}) {
  const headers = new Headers(options.headers ?? {});
  const fetchOptions = {
    ...options,
    headers,
  };

  if (options.body !== undefined && typeof options.body !== "string") {
    headers.set("content-type", "application/json");
    fetchOptions.body = JSON.stringify(options.body);
  }

  const response = await fetch(`${baseUrl}${path}`, fetchOptions);
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;

  return {
    status: response.status,
    headers: response.headers,
    body,
  };
}

export function authHeaders(accessToken) {
  return {
    authorization: `Bearer ${accessToken}`,
  };
}

export function createRegisterPayload(overrides = {}) {
  return {
    email: uniqueEmail("auth"),
    authHash: DEFAULT_AUTH_HASH,
    kdfSalt: "integration-kdf-salt",
    kdfIterations: 600000,
    ...overrides,
  };
}

export async function registerUser(baseUrl, overrides = {}) {
  const payload = createRegisterPayload(overrides);
  const response = await request(baseUrl, "/api/auth/register", {
    method: "POST",
    body: payload,
  });

  return {
    payload,
    response,
    data: response.body?.data,
    accessToken: response.body?.data?.tokens?.accessToken,
    refreshToken: response.body?.data?.tokens?.refreshToken,
  };
}

export async function loginUser(baseUrl, payload, overrides = {}) {
  const response = await request(baseUrl, "/api/auth/login", {
    method: "POST",
    body: {
      email: payload.email,
      authHash: payload.authHash,
      ...overrides,
    },
  });

  return {
    response,
    data: response.body?.data,
    accessToken: response.body?.data?.tokens?.accessToken,
    refreshToken: response.body?.data?.tokens?.refreshToken,
  };
}

export function vaultPayload(overrides = {}) {
  return {
    encryptedData: "encrypted-payload",
    iv: "initial-vector",
    favorite: false,
    ...overrides,
  };
}
