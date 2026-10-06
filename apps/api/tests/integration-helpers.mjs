import { sensitiveAction } from "../../../packages/shared/dist/index.js";
const testCredentials = new Map();
const TEST_EMAIL_DOMAIN = "example.integration.test";
const DEFAULT_AUTH_HASH = "integration-auth-hash";

// Integration tests must explicitly select their database. Never fall back to a
// deployment .env, which may contain the production vault connection string.
if (!process.env.VAULTMASTER_TEST_DATABASE_URL) {
  throw new Error("VAULTMASTER_TEST_DATABASE_URL is required; use a dedicated test database");
}
process.env.DATABASE_URL = process.env.VAULTMASTER_TEST_DATABASE_URL;
process.env.DATABASE_DIRECT_URL = process.env.VAULTMASTER_TEST_DATABASE_DIRECT_URL || process.env.DATABASE_URL;

process.env.NODE_ENV = "test";
process.env.JWT_SECRET ||= "a".repeat(32);
process.env.JWT_REFRESH_SECRET ||= "b".repeat(32);
process.env.JWT_EXPIRES_IN ||= "15m";
process.env.JWT_REFRESH_EXPIRES_IN ||= "7d";
process.env.API_PORT ||= "4000";
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

export async function startTestServer({ resetLimits = true } = {}) {
  if (resetLimits) { const { prisma } = await loadPrismaModule(); await prisma.abuseBucket.deleteMany(); }
  const { createApp } = await loadAppModule();
  const server = createApp().listen(0, '127.0.0.1');
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

  if (response.body?.data?.tokens?.accessToken) testCredentials.set(response.body.data.tokens.accessToken, payload.authHash);
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
      vaultKeyProtocol: 1,
      ...overrides,
    },
  });

  if (response.body?.data?.tokens?.accessToken) testCredentials.set(response.body.data.tokens.accessToken, overrides.authHash ?? payload.authHash);
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

export function attachmentPayload(overrides = {}) {
  return {
    encryptedMetadata: "encrypted-metadata",
    metadataIv: "metadata-iv",
    encryptedBlob: "encrypted-file-blob",
    blobIv: "blob-iv",
    size: 512,
    ...overrides,
  };
}

export function sharedVaultPayload(overrides = {}) {
  return {
    encryptedMetadata: "encrypted-shared-metadata",
    metadataIv: "shared-metadata-iv",
    encryptedVaultKey: "owner-wrapped-vault-key",
    encryptedVaultKeyIv: "owner-wrapped-vault-key-iv",
    ...overrides,
  };
}

export function sharedVaultInvitePayload(overrides = {}) {
  return {
    email: uniqueEmail("invitee"),
    role: "viewer",
    encryptedVaultKey: "recipient-wrapped-vault-key",
    encryptedVaultKeyIv: "recipient-wrapped-vault-key-iv",
    ...overrides,
  };
}

export function sharedVaultItemPayload(overrides = {}) {
  return {
    encryptedData: "encrypted-shared-item-payload",
    iv: "shared-item-iv",
    favorite: false,
    ...overrides,
  };
}

export function emergencyAccessPayload(overrides = {}) {
  return {
    contactEmail: uniqueEmail("emergency-contact"),
    encryptedAccessKey: "contact-wrapped-recovery-key",
    encryptedAccessIv: "contact-wrapped-recovery-key-iv",
    waitTimeDays: 7,
    ...overrides,
  };
}

// Explicit adapter for legacy regression suites: each protected request obtains
// a real proof through the public endpoint. Security tests use raw request().
export async function authorizedRequest(baseUrl, path, options = {}) {
  const method = options.method ?? 'GET';
  const target = path.replace(/^\/api/, '').split('?')[0];
  const headers = new Headers(options.headers);
  const accessToken = headers.get('authorization')?.replace(/^Bearer /, '');
  if (accessToken && sensitiveAction(method, target) && !headers.has('x-vaultmaster-reauth')) {
    const body = options.body ?? {};
    const proof = await request(baseUrl, '/api/auth/reauthenticate', { method: 'POST', headers,
      body: { method, path: target, authHash: body.currentAuthHash ?? body.authHash ?? testCredentials.get(accessToken),
        code: body.code, recoveryCode: body.recoveryCode } });
    if (proof.status !== 200 || !proof.body.data.proof) return proof.status === 200 ? { ...proof, status: 403 } : proof;
    headers.set('x-vaultmaster-reauth', proof.body.data.proof);
  }
  return request(baseUrl, path, { ...options, headers });
}
