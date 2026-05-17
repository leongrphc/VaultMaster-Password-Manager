import test from "node:test";
import assert from "node:assert/strict";
import * as OTPAuth from "otpauth";
import {
  authHeaders,
  cleanupIntegrationUsers,
  disconnectPrisma,
  loginUser,
  registerUser,
  request,
  startTestServer,
  stopTestServer,
} from "./integration-helpers.mjs";

let server;
let baseUrl;

function currentTotp(secret) {
  return new OTPAuth.TOTP({
    issuer: "VaultMaster",
    label: "integration-test",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  }).generate();
}

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

test("2FA setup, verify, login challenge, TOTP login, and disable flow works", async () => {
  const user = await registerUser(baseUrl);
  assert.equal(user.response.status, 201);

  const verifyBeforeSetup = await request(baseUrl, "/api/auth/2fa/verify", {
    method: "POST",
    headers: authHeaders(user.accessToken),
    body: { code: "000000" },
  });
  assert.equal(verifyBeforeSetup.status, 400);

  const setup = await request(baseUrl, "/api/auth/2fa/setup", {
    method: "POST",
    headers: authHeaders(user.accessToken),
  });
  assert.equal(setup.status, 200);
  assert.equal(setup.body.success, true);
  assert.ok(setup.body.data.secret);
  assert.ok(setup.body.data.otpauthUrl);
  assert.ok(setup.body.data.qrCode);

  const verify = await request(baseUrl, "/api/auth/2fa/verify", {
    method: "POST",
    headers: authHeaders(user.accessToken),
    body: { code: currentTotp(setup.body.data.secret) },
  });
  assert.equal(verify.status, 200);
  assert.equal(verify.body.success, true);
  assert.ok(Array.isArray(verify.body.data.recoveryCodes));
  assert.ok(verify.body.data.recoveryCodes.length > 0);

  const enabledStatus = await request(baseUrl, "/api/auth/2fa/status", {
    headers: authHeaders(user.accessToken),
  });
  assert.equal(enabledStatus.status, 200);
  assert.equal(enabledStatus.body.data.enabled, true);
  assert.equal(
    enabledStatus.body.data.recoveryCodesRemaining,
    verify.body.data.recoveryCodes.length
  );

  const challengedLogin = await loginUser(baseUrl, user.payload);
  assert.equal(challengedLogin.response.status, 200);
  assert.deepEqual(challengedLogin.response.body.data, { requires2FA: true });

  const invalidCodeLogin = await loginUser(baseUrl, user.payload, { code: "000000" });
  assert.equal(invalidCodeLogin.response.status, 401);

  const totpLogin = await loginUser(baseUrl, user.payload, {
    code: currentTotp(setup.body.data.secret),
  });
  assert.equal(totpLogin.response.status, 200);
  assert.ok(totpLogin.accessToken);
  assert.ok(totpLogin.refreshToken);

  const disableWithoutCode = await request(baseUrl, "/api/auth/2fa/disable", {
    method: "POST",
    headers: authHeaders(totpLogin.accessToken),
    body: {},
  });
  assert.equal(disableWithoutCode.status, 400);

  const disable = await request(baseUrl, "/api/auth/2fa/disable", {
    method: "POST",
    headers: authHeaders(totpLogin.accessToken),
    body: { code: currentTotp(setup.body.data.secret) },
  });
  assert.equal(disable.status, 200);
  assert.equal(disable.body.success, true);

  const disabledStatus = await request(baseUrl, "/api/auth/2fa/status", {
    headers: authHeaders(totpLogin.accessToken),
  });
  assert.equal(disabledStatus.status, 200);
  assert.equal(disabledStatus.body.data.enabled, false);

  const plainLogin = await loginUser(baseUrl, user.payload);
  assert.equal(plainLogin.response.status, 200);
  assert.ok(plainLogin.accessToken);
});
