import test from "node:test";
import assert from "node:assert/strict";
import {
  authHeaders,
  cleanupIntegrationUsers,
  disconnectPrisma,
  registerUser,
  request,
  sharedVaultPayload,
  sharedVaultInvitePayload,
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

test("shared vault create/list/invite stores encrypted key material only", async () => {
  const owner = await registerUser(baseUrl);
  const invitee = await registerUser(baseUrl);
  const ownerHeaders = authHeaders(owner.accessToken);

  const created = await request(baseUrl, "/api/shared-vaults", {
    method: "POST",
    headers: ownerHeaders,
    body: sharedVaultPayload(),
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.data.encryptedMetadata, "encrypted-shared-metadata");
  assert.equal(created.body.data.metadataIv, "shared-metadata-iv");
  assert.equal(created.body.data.encryptedVaultKey, undefined);
  const sharedVaultId = created.body.data.id;

  const ownerList = await request(baseUrl, "/api/shared-vaults", { headers: ownerHeaders });
  assert.equal(ownerList.status, 200);
  assert.equal(ownerList.body.data.length, 1);
  assert.equal(ownerList.body.data[0].currentUserMembership.role, "owner");
  assert.equal(ownerList.body.data[0].currentUserMembership.encryptedVaultKey, "owner-wrapped-vault-key");

  const invited = await request(baseUrl, `/api/shared-vaults/${sharedVaultId}/invite`, {
    method: "POST",
    headers: ownerHeaders,
    body: sharedVaultInvitePayload({ email: invitee.payload.email }),
  });
  assert.equal(invited.status, 201);
  assert.equal(invited.body.data.email, invitee.payload.email.toLowerCase());
  assert.equal(invited.body.data.role, "viewer");
  assert.equal(invited.body.data.status, "pending");
  assert.equal(invited.body.data.encryptedVaultKey, "recipient-wrapped-vault-key");

  const inviteeList = await request(baseUrl, "/api/shared-vaults", {
    headers: authHeaders(invitee.accessToken),
  });
  assert.equal(inviteeList.status, 200);
  assert.equal(inviteeList.body.data.length, 1);
  assert.equal(inviteeList.body.data[0].id, sharedVaultId);
  assert.equal(inviteeList.body.data[0].currentUserMembership.encryptedVaultKey, "recipient-wrapped-vault-key");
});

test("shared vault member management enforces owner/admin/member roles", async () => {
  const owner = await registerUser(baseUrl);
  const admin = await registerUser(baseUrl);
  const viewer = await registerUser(baseUrl);
  const outsider = await registerUser(baseUrl);
  const ownerHeaders = authHeaders(owner.accessToken);

  const created = await request(baseUrl, "/api/shared-vaults", {
    method: "POST",
    headers: ownerHeaders,
    body: sharedVaultPayload(),
  });
  assert.equal(created.status, 201);
  const sharedVaultId = created.body.data.id;

  const adminInvite = await request(baseUrl, `/api/shared-vaults/${sharedVaultId}/invite`, {
    method: "POST",
    headers: ownerHeaders,
    body: sharedVaultInvitePayload({ email: admin.payload.email, role: "admin" }),
  });
  assert.equal(adminInvite.status, 201);

  const viewerInvite = await request(baseUrl, `/api/shared-vaults/${sharedVaultId}/invite`, {
    method: "POST",
    headers: authHeaders(admin.accessToken),
    body: sharedVaultInvitePayload({ email: viewer.payload.email, role: "viewer" }),
  });
  assert.equal(viewerInvite.status, 201);

  const viewerInviteAdmin = await request(baseUrl, `/api/shared-vaults/${sharedVaultId}/invite`, {
    method: "POST",
    headers: authHeaders(viewer.accessToken),
    body: sharedVaultInvitePayload({ email: outsider.payload.email, role: "viewer" }),
  });
  assert.equal(viewerInviteAdmin.status, 403);

  const outsiderMembers = await request(baseUrl, `/api/shared-vaults/${sharedVaultId}/members`, {
    headers: authHeaders(outsider.accessToken),
  });
  assert.equal(outsiderMembers.status, 404);

  const members = await request(baseUrl, `/api/shared-vaults/${sharedVaultId}/members`, {
    headers: authHeaders(admin.accessToken),
  });
  assert.equal(members.status, 200);
  assert.equal(members.body.data.length, 3);
  const ownerMember = members.body.data.find((member) => member.userId === owner.data.user.id);
  const adminMember = members.body.data.find((member) => member.userId === admin.data.user.id);
  const viewerMember = members.body.data.find((member) => member.userId === viewer.data.user.id);
  assert.ok(ownerMember);
  assert.ok(adminMember);
  assert.ok(viewerMember);

  const adminRemoveOwner = await request(baseUrl, `/api/shared-vaults/${sharedVaultId}/members/${ownerMember.id}`, {
    method: "DELETE",
    headers: authHeaders(admin.accessToken),
  });
  assert.equal(adminRemoveOwner.status, 403);

  const viewerRemoveAdmin = await request(baseUrl, `/api/shared-vaults/${sharedVaultId}/members/${adminMember.id}`, {
    method: "DELETE",
    headers: authHeaders(viewer.accessToken),
  });
  assert.equal(viewerRemoveAdmin.status, 403);

  const adminRemoveViewer = await request(baseUrl, `/api/shared-vaults/${sharedVaultId}/members/${viewerMember.id}`, {
    method: "DELETE",
    headers: authHeaders(admin.accessToken),
  });
  assert.equal(adminRemoveViewer.status, 200);

  const ownerRemoveAdmin = await request(baseUrl, `/api/shared-vaults/${sharedVaultId}/members/${adminMember.id}`, {
    method: "DELETE",
    headers: ownerHeaders,
  });
  assert.equal(ownerRemoveAdmin.status, 200);
});
