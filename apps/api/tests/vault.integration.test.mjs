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
  vaultPayload,
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

test("vault CRUD covers history, trash, restore, and purge", async () => {
  const user = await registerUser(baseUrl);
  const headers = authHeaders(user.accessToken);

  const emptyList = await request(baseUrl, "/api/vault", { headers });
  assert.equal(emptyList.status, 200);
  assert.deepEqual(emptyList.body.data, []);

  const created = await request(baseUrl, "/api/vault", {
    method: "POST",
    headers,
    body: vaultPayload(),
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.success, true);
  const itemId = created.body.data.id;
  assert.ok(itemId);

  const fetched = await request(baseUrl, `/api/vault/${itemId}`, { headers });
  assert.equal(fetched.status, 200);
  assert.equal(fetched.body.data.id, itemId);
  assert.equal(fetched.body.data.encryptedData, "encrypted-payload");

  const updated = await request(baseUrl, `/api/vault/${itemId}`, {
    method: "PUT",
    headers,
    body: vaultPayload({ encryptedData: "updated-payload", favorite: true }),
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.data.encryptedData, "updated-payload");
  assert.equal(updated.body.data.favorite, true);

  const history = await request(baseUrl, `/api/vault/${itemId}/history`, { headers });
  assert.equal(history.status, 200);
  assert.ok(history.body.data.length >= 1);

  const deleted = await request(baseUrl, `/api/vault/${itemId}`, {
    method: "DELETE",
    headers,
  });
  assert.equal(deleted.status, 200);

  const activeList = await request(baseUrl, "/api/vault", { headers });
  assert.equal(activeList.status, 200);
  assert.equal(activeList.body.data.some((item) => item.id === itemId), false);

  const trash = await request(baseUrl, "/api/vault/trash", { headers });
  assert.equal(trash.status, 200);
  assert.equal(trash.body.data.some((item) => item.id === itemId), true);

  const restored = await request(baseUrl, `/api/vault/${itemId}/restore`, {
    method: "POST",
    headers,
  });
  assert.equal(restored.status, 200);
  assert.equal(restored.body.data.deletedAt, null);

  await request(baseUrl, `/api/vault/${itemId}`, { method: "DELETE", headers });
  const purged = await request(baseUrl, `/api/vault/${itemId}/purge`, {
    method: "DELETE",
    headers,
  });
  assert.equal(purged.status, 200);

  const missing = await request(baseUrl, `/api/vault/${itemId}`, { headers });
  assert.equal(missing.status, 404);
});

test("vault item ids are not accessible across users", async () => {
  const owner = await registerUser(baseUrl);
  const other = await registerUser(baseUrl);

  const created = await request(baseUrl, "/api/vault", {
    method: "POST",
    headers: authHeaders(owner.accessToken),
    body: vaultPayload(),
  });
  assert.equal(created.status, 201);
  const itemId = created.body.data.id;

  const otherHeaders = authHeaders(other.accessToken);
  const getAttempt = await request(baseUrl, `/api/vault/${itemId}`, {
    headers: otherHeaders,
  });
  assert.equal(getAttempt.status, 404);

  const updateAttempt = await request(baseUrl, `/api/vault/${itemId}`, {
    method: "PUT",
    headers: otherHeaders,
    body: vaultPayload({ encryptedData: "cross-user-update" }),
  });
  assert.equal(updateAttempt.status, 404);

  const deleteAttempt = await request(baseUrl, `/api/vault/${itemId}`, {
    method: "DELETE",
    headers: otherHeaders,
  });
  assert.equal(deleteAttempt.status, 404);
});
