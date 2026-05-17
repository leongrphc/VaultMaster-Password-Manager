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

test("folder CRUD reports active item counts", async () => {
  const user = await registerUser(baseUrl);
  const headers = authHeaders(user.accessToken);

  const emptyList = await request(baseUrl, "/api/folders", { headers });
  assert.equal(emptyList.status, 200);
  assert.deepEqual(emptyList.body.data, []);

  const created = await request(baseUrl, "/api/folders", {
    method: "POST",
    headers,
    body: { name: "Personal" },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.data.name, "Personal");
  assert.equal(created.body.data._count.items, 0);
  const folderId = created.body.data.id;

  const updated = await request(baseUrl, `/api/folders/${folderId}`, {
    method: "PUT",
    headers,
    body: { name: "Renamed" },
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.data.name, "Renamed");

  const item = await request(baseUrl, "/api/vault", {
    method: "POST",
    headers,
    body: vaultPayload({ folderId }),
  });
  assert.equal(item.status, 201);

  const listWithCount = await request(baseUrl, "/api/folders", { headers });
  assert.equal(listWithCount.status, 200);
  const listedFolder = listWithCount.body.data.find((folder) => folder.id === folderId);
  assert.equal(listedFolder._count.items, 1);

  const deleted = await request(baseUrl, `/api/folders/${folderId}`, {
    method: "DELETE",
    headers,
  });
  assert.equal(deleted.status, 200);
});

test("folders and folder assignment are scoped to the current user", async () => {
  const owner = await registerUser(baseUrl);
  const other = await registerUser(baseUrl);

  const created = await request(baseUrl, "/api/folders", {
    method: "POST",
    headers: authHeaders(owner.accessToken),
    body: { name: "Owner Folder" },
  });
  assert.equal(created.status, 201);
  const folderId = created.body.data.id;

  const otherHeaders = authHeaders(other.accessToken);
  const updateAttempt = await request(baseUrl, `/api/folders/${folderId}`, {
    method: "PUT",
    headers: otherHeaders,
    body: { name: "Cross User" },
  });
  assert.equal(updateAttempt.status, 404);

  const deleteAttempt = await request(baseUrl, `/api/folders/${folderId}`, {
    method: "DELETE",
    headers: otherHeaders,
  });
  assert.equal(deleteAttempt.status, 404);

  const vaultCreateAttempt = await request(baseUrl, "/api/vault", {
    method: "POST",
    headers: otherHeaders,
    body: vaultPayload({ folderId }),
  });
  assert.equal(vaultCreateAttempt.status, 404);
});
