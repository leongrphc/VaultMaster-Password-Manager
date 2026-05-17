import test from "node:test";
import assert from "node:assert/strict";
import {
  cleanupIntegrationUsers,
  disconnectPrisma,
  request,
  startTestServer,
  stopTestServer,
  uniqueEmail,
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

test("auth login limiter returns 429 after repeated attempts for one email", async () => {
  const email = uniqueEmail("rate-limit");
  let response;

  for (let attempt = 0; attempt < 10; attempt += 1) {
    response = await request(baseUrl, "/api/auth/login", {
      method: "POST",
      body: {
        email,
        authHash: "wrong-auth-hash",
      },
    });
    assert.equal(response.status, 401);
    assert.equal(response.body.success, false);
  }

  response = await request(baseUrl, "/api/auth/login", {
    method: "POST",
    body: {
      email,
      authHash: "wrong-auth-hash",
    },
  });

  assert.equal(response.status, 429);
  assert.equal(response.body.success, false);
  assert.ok(response.headers.get("ratelimit-limit"));
  assert.ok(response.headers.get("ratelimit-remaining"));
  assert.ok(response.headers.get("ratelimit-reset"));
});
