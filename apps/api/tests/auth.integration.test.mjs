import test from "node:test";
import assert from "node:assert/strict";
import {
  cleanupIntegrationUsers,
  disconnectPrisma,
  loginUser,
  registerUser,
  request,
  startTestServer,
  stopTestServer,
  createRegisterPayload,
} from "./integration-helpers.mjs";

let server;
let baseUrl;

test.before(async () => {
  await cleanupIntegrationUsers();
  const started = await startTestServer();
  server = started.server;
  baseUrl = started.baseUrl;
});

test.after(async () => {
  await stopTestServer(server);
  await cleanupIntegrationUsers();
  await disconnectPrisma();
});

test("register validates payloads and normalizes duplicate emails", async () => {
  const invalid = await request(baseUrl, "/api/auth/register", {
    method: "POST",
    body: {
      email: "not-an-email",
    },
  });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.success, false);

  const payload = createRegisterPayload({ email: "MixedCase@Example.Integration.Test" });
  const registered = await request(baseUrl, "/api/auth/register", {
    method: "POST",
    body: payload,
  });
  assert.equal(registered.status, 201);
  assert.equal(registered.body.success, true);
  assert.equal(registered.body.data.user.email, "mixedcase@example.integration.test");
  assert.ok(registered.body.data.user.id);
  assert.ok(registered.body.data.tokens.accessToken);
  assert.ok(registered.body.data.tokens.refreshToken);
  assert.ok(registered.body.data.deviceId);
  assert.equal(registered.body.data.kdfSalt, payload.kdfSalt);
  assert.equal(registered.body.data.kdfIterations, payload.kdfIterations);

  const duplicate = await request(baseUrl, "/api/auth/register", {
    method: "POST",
    body: {
      ...payload,
      email: "mixedcase@example.integration.test",
    },
  });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.success, false);
});

test("login returns tokens for valid credentials and rejects wrong auth hash", async () => {
  const user = await registerUser(baseUrl);
  assert.equal(user.response.status, 201);

  const login = await loginUser(baseUrl, user.payload);
  assert.equal(login.response.status, 200);
  assert.equal(login.response.body.success, true);
  assert.ok(login.accessToken);
  assert.ok(login.refreshToken);
  assert.ok(login.data.deviceId);

  const wrongPassword = await loginUser(baseUrl, user.payload, {
    authHash: "wrong-auth-hash",
  });
  assert.equal(wrongPassword.response.status, 401);
  assert.equal(wrongPassword.response.body.success, false);
});

test("refresh token rotation rejects reused tokens and revokes the device", async () => {
  const user = await registerUser(baseUrl);
  assert.equal(user.response.status, 201);

  const rotated = await request(baseUrl, "/api/auth/refresh", {
    method: "POST",
    body: {
      refreshToken: user.refreshToken,
    },
  });
  assert.equal(rotated.status, 200);
  assert.equal(rotated.body.success, true);
  const nextRefreshToken = rotated.body.data.tokens.refreshToken;
  assert.ok(nextRefreshToken);
  assert.notEqual(nextRefreshToken, user.refreshToken);

  const reused = await request(baseUrl, "/api/auth/refresh", {
    method: "POST",
    body: {
      refreshToken: user.refreshToken,
    },
  });
  assert.equal(reused.status, 401);
  assert.equal(reused.body.success, false);

  const afterReuseDetection = await request(baseUrl, "/api/auth/refresh", {
    method: "POST",
    body: {
      refreshToken: nextRefreshToken,
    },
  });
  assert.equal(afterReuseDetection.status, 401);
  assert.equal(afterReuseDetection.body.success, false);
});
