import test from "node:test";
import assert from "node:assert/strict";
import {
  authHeaders,
  cleanupIntegrationUsers,
  disconnectPrisma,
  registerUser,
  request,
  startTestServer,
  stopTestServer,
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

test("WebAuthn registration options, listing, and ownership checks work", async () => {
  const user = await registerUser(baseUrl);
  assert.equal(user.response.status, 201);

  const options = await request(baseUrl, "/api/auth/webauthn/registration/options", {
    method: "POST",
    headers: authHeaders(user.accessToken),
  });
  assert.equal(options.status, 200);
  assert.equal(options.body.success, true);
  assert.ok(options.body.data.challengeToken);
  assert.equal(options.body.data.options.rp.name, "VaultMaster");
  assert.ok(options.body.data.options.challenge);

  const credentials = await request(baseUrl, "/api/auth/webauthn/credentials", {
    headers: authHeaders(user.accessToken),
  });
  assert.equal(credentials.status, 200);
  assert.deepEqual(credentials.body.data, []);

  const missingRename = await request(baseUrl, "/api/auth/webauthn/credentials/00000000-0000-0000-0000-000000000000", {
    method: "PATCH",
    headers: authHeaders(user.accessToken),
    body: { name: "Renamed key" },
  });
  assert.equal(missingRename.status, 404);

  const missingDelete = await request(baseUrl, "/api/auth/webauthn/credentials/00000000-0000-0000-0000-000000000000", {
    method: "DELETE",
    headers: authHeaders(user.accessToken),
  });
  assert.equal(missingDelete.status, 404);
});
