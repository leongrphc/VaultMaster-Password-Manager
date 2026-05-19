import test from "node:test";
import assert from "node:assert/strict";
import {
  authHeaders,
  cleanupIntegrationUsers,
  disconnectPrisma,
  emergencyAccessPayload,
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

test("emergency access invitation and request lifecycle protects encrypted key release", async () => {
  const owner = await registerUser(baseUrl);
  const contact = await registerUser(baseUrl);
  const ownerHeaders = authHeaders(owner.accessToken);
  const contactHeaders = authHeaders(contact.accessToken);

  const invited = await request(baseUrl, "/api/emergency-access", {
    method: "POST",
    headers: ownerHeaders,
    body: emergencyAccessPayload({ contactEmail: contact.payload.email }),
  });
  assert.equal(invited.status, 201);
  assert.equal(invited.body.data.status, "pending");
  assert.equal(invited.body.data.contactEmail, contact.payload.email.toLowerCase());
  assert.equal(invited.body.data.encryptedAccessKey, undefined);
  const grantId = invited.body.data.id;

  const contactList = await request(baseUrl, "/api/emergency-access", { headers: contactHeaders });
  assert.equal(contactList.status, 200);
  assert.equal(contactList.body.data.length, 1);
  assert.equal(contactList.body.data[0].encryptedAccessKey, undefined);

  const earlyRelease = await request(baseUrl, `/api/emergency-access/${grantId}/release`, {
    headers: contactHeaders,
  });
  assert.equal(earlyRelease.status, 403);

  const accepted = await request(baseUrl, `/api/emergency-access/${grantId}/accept`, {
    method: "POST",
    headers: contactHeaders,
  });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.data.status, "active");

  const requested = await request(baseUrl, `/api/emergency-access/${grantId}/request`, {
    method: "POST",
    headers: contactHeaders,
  });
  assert.equal(requested.status, 200);
  assert.equal(requested.body.data.status, "requested");
  assert.ok(requested.body.data.requestedAt);
  assert.ok(requested.body.data.availableAt);

  const approved = await request(baseUrl, `/api/emergency-access/${grantId}/approve`, {
    method: "POST",
    headers: ownerHeaders,
  });
  assert.equal(approved.status, 200);
  assert.equal(approved.body.data.status, "approved");
  assert.equal(approved.body.data.encryptedAccessKey, undefined);

  const released = await request(baseUrl, `/api/emergency-access/${grantId}/release`, {
    headers: contactHeaders,
  });
  assert.equal(released.status, 200);
  assert.equal(released.body.data.encryptedAccessKey, "contact-wrapped-recovery-key");
  assert.equal(released.body.data.encryptedAccessIv, "contact-wrapped-recovery-key-iv");
});

test("emergency access owner can reject requests and cancel grants", async () => {
  const owner = await registerUser(baseUrl);
  const contact = await registerUser(baseUrl);
  const ownerHeaders = authHeaders(owner.accessToken);
  const contactHeaders = authHeaders(contact.accessToken);

  const invited = await request(baseUrl, "/api/emergency-access", {
    method: "POST",
    headers: ownerHeaders,
    body: emergencyAccessPayload({ contactEmail: contact.payload.email, waitTimeDays: 3 }),
  });
  assert.equal(invited.status, 201);
  const grantId = invited.body.data.id;

  const accepted = await request(baseUrl, `/api/emergency-access/${grantId}/accept`, {
    method: "POST",
    headers: contactHeaders,
  });
  assert.equal(accepted.status, 200);

  const requested = await request(baseUrl, `/api/emergency-access/${grantId}/request`, {
    method: "POST",
    headers: contactHeaders,
  });
  assert.equal(requested.status, 200);

  const rejected = await request(baseUrl, `/api/emergency-access/${grantId}/reject`, {
    method: "POST",
    headers: ownerHeaders,
  });
  assert.equal(rejected.status, 200);
  assert.equal(rejected.body.data.status, "active");
  assert.equal(rejected.body.data.requestedAt, null);
  assert.equal(rejected.body.data.availableAt, null);

  const deniedRelease = await request(baseUrl, `/api/emergency-access/${grantId}/release`, {
    headers: contactHeaders,
  });
  assert.equal(deniedRelease.status, 403);

  const cancelled = await request(baseUrl, `/api/emergency-access/${grantId}/cancel`, {
    method: "POST",
    headers: ownerHeaders,
  });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.data.status, "cancelled");

  const requestAfterCancel = await request(baseUrl, `/api/emergency-access/${grantId}/request`, {
    method: "POST",
    headers: contactHeaders,
  });
  assert.equal(requestAfterCancel.status, 403);
});
