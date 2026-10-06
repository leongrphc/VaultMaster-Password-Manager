import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

async function loadBackground({ frames: fixtureFrames, onVaultRequest, vaultTab = { id: 7, windowId: 1 }, tabResponse = { ok: true, payload: { valid: true } } } = {}) {
  const listeners = [];
  const localStorage = new Map();
  const sessionStorage = new Map();
  const tabMessages = [];
  let currentSender;


  globalThis.chrome = {
    runtime: {
      id: 'fixture-extension',
      getURL: path => `chrome-extension://fixture-extension/${path}`,
      lastError: null,
      onMessage: { addListener: (listener) => listeners.push(listener) },
      onInstalled: { addListener: () => undefined },
    },
    webNavigation: { getAllFrames: async () => {
      if (fixtureFrames) return fixtureFrames;
      const sender = currentSender;
      const origin = sender?.tab?.url || sender?.url || 'https://example.com';
      const main = { frameId: 0, parentFrameId: -1, documentId: 'main', url: origin, documentLifecycle: 'active' };
      return sender?.frameId > 0 ? [main, { frameId: sender.frameId, parentFrameId: 0,
        parentDocumentId: 'main', documentId: 'child', url: sender.url, documentLifecycle: 'active' }] : [main];
    } },
    commands: { onCommand: { addListener: () => undefined } },
    contextMenus: {
      onClicked: { addListener: () => undefined },
      removeAll: (callback) => callback?.(),
      create: () => undefined,
    },
    tabs: {
      query: async () => (vaultTab ? [vaultTab] : []),
      update: async () => undefined,
      create: async () => undefined,
      sendMessage: (_tabId, payload, callback) => {
        tabMessages.push(payload);
        callback(tabResponse);
      },
    },
    windows: { update: async () => undefined },
    action: {
      setBadgeText: () => undefined,
      setBadgeBackgroundColor: () => undefined,
    },
    storage: {
      local: createStorageArea(localStorage),
      session: createStorageArea(sessionStorage),
    },
  };

  globalThis.__vaultFixture = { ready: Promise.resolve(), status: async () => ({ isAuthenticated: true, isLocked: false }),
    request: async (type, payload) => { await onVaultRequest?.(); tabMessages.push({ type, ...payload }); return tabResponse; } };
  const source = (await readFile(resolve("src/background.js"), "utf8"))
    .replace("import { nativeVault } from './vault-session.js';", 'const nativeVault = globalThis.__vaultFixture;');
  await import(`data:text/javascript,${encodeURIComponent(source)}#${Date.now()}-${Math.random()}`);

  return {
    tabMessages,
    sessionStorage,
    async send(message, sender = { tab: { id: 42 }, url: "https://example.com/login", frameId: 0 }) {
      sender = { documentId: sender.frameId > 0 ? 'child' : 'main', ...sender };
      currentSender = sender;
      return new Promise((resolve) => {
        for (const listener of listeners) {
          if (listener(message, sender, resolve) === true) {
            return;
          }
        }
        assert.fail(`No listener handled ${message.type}`);
      });
    },
  };
}

for (const type of ['NATIVE_LOGIN', 'NATIVE_UNLOCK', 'NATIVE_LOCK', 'NATIVE_LOGOUT', 'NATIVE_SYNC', 'NATIVE_STATUS']) {
  test(`${type} cannot be invoked by a content script or another extension`, async () => {
    const background = await loadBackground();
    assert.equal((await background.send({ type, password: 'must-not-be-accepted' })).ok, false);
    assert.equal((await background.send({ type }, { id: 'other-extension', url: 'chrome-extension://fixture-extension/popup.html' })).ok, false);
  });
}

function createStorageArea(storage) {
  return {
    async get(key) {
      if (Array.isArray(key)) {
        return Object.fromEntries(key.map((entry) => [entry, storage.get(entry)]));
      }
      return { [key]: storage.get(key) };
    },
    async set(values) {
      for (const [key, value] of Object.entries(values)) {
        storage.set(key, value);
      }
    },
  };
}

test("stores pending autofill without sensitive fields", async () => {
  const background = await loadBackground();

  const response = await background.send({
    type: "SET_PENDING_AUTOFILL",
    pendingAutofill: {
      itemId: "item-1",
      nonce: "nonce-1",
      title: "GitHub",
      username: "octo",
      hostname: "example.com",
      origin: "https://example.com",
      expiresAt: Date.now() + 20000,
      password: "secret-password",
      totp: "123456",
      totpCode: "654321",
      cvv: "123",
    },
  });

  assert.deepEqual(response, { ok: true });
  const stored = background.sessionStorage.get("vaultmasterPendingAutofill");
  assert.equal(stored["42:0"].itemId, "item-1");
  assert.equal(stored["42:0"].nonce, "nonce-1");
  assert.equal("password" in stored["42:0"], false);
  assert.equal("totp" in stored["42:0"], false);
  assert.equal("totpCode" in stored["42:0"], false);
  assert.equal("cvv" in stored["42:0"], false);
});

test("rejects invalid domain validation payloads", async () => {
  const background = await loadBackground();

  const response = await background.send({
    type: "VALIDATE_CREDENTIAL_DOMAIN",
    itemId: "item-1",
    expectedUrl: "javascript:alert(1)",
  });

  assert.deepEqual(response, { ok: false, error: "Invalid message payload" });
  assert.equal(background.tabMessages.length, 0);
});

test("forwards valid domain validation requests to the vault tab", async () => {
  const background = await loadBackground({ tabResponse: { ok: true, payload: { valid: false } } });

  const response = await background.send(
    {
      type: "VALIDATE_CREDENTIAL_DOMAIN",
      itemId: "item-1",
      expectedUrl: "https://phishing.example/login",
    },
    { tab: { id: 99 }, url: "https://phishing.example/login" }
  );

  assert.deepEqual(response, { ok: true, payload: { valid: false } });
  assert.deepEqual(background.tabMessages[0], {
    type: "VM_VALIDATE_CREDENTIAL_DOMAIN_REQUEST",
    itemId: "item-1",
    pageUrl: "https://phishing.example/login",
    sourceTabId: 99,
  });
});

test("accepts passkey intercepts only when page origin and rpId match", async () => {
  const background = await loadBackground({
    tabResponse: {
      ok: true,
      payload: {
        status: "candidates_available",
        candidates: [{ itemId: "passkey-1", title: "Example", rpId: "example.com" }],
      },
    },
  });

  const response = await background.send(
    {
      type: "PASSKEY_INTERCEPTED",
      operation: "get",
      requestId: "passkey-1",
      pageUrl: "https://login.example.com/account",
      origin: "https://login.example.com",
      rpId: "example.com",
      allowCredentialIds: ["Y3JlZC0xMjM"],
    },
    { tab: { id: 99, url: "https://login.example.com/account" } }
  );

  assert.equal(response.ok, true);
  assert.equal(response.payload.status, "candidates_available");
  assert.equal(response.payload.rpId, "example.com");
  assert.equal(response.payload.sourceTabId, 99);
  assert.deepEqual(response.payload.candidates, [{ itemId: "passkey-1", title: "Example", rpId: "example.com" }]);
  assert.deepEqual(background.tabMessages[0], {
    type: "VM_PASSKEY_BRIDGE_REQUEST",
    operation: "get",
    rpId: "example.com",
    rpName: "",
    userName: "",
    userDisplayName: "",
    allowCredentialIds: ["Y3JlZC0xMjM"],
    origin: "https://login.example.com",
    pageUrl: "https://login.example.com/account",
    sourceTabId: 99,
  });
});

test("rejects passkey intercepts with mismatched sender tab URL", async () => {
  const background = await loadBackground();

  const response = await background.send(
    {
      type: "PASSKEY_INTERCEPTED",
      operation: "get",
      requestId: "passkey-1",
      pageUrl: "https://example.com/login",
      origin: "https://example.com",
      rpId: "example.com",
    },
    { tab: { id: 99, url: "https://attacker.example/login" } }
  );

  assert.deepEqual(response, { ok: false, error: "Invalid message payload" });
  assert.equal(background.tabMessages.length, 0);
});

test("blocks passkey intercepts when rpId is outside the page origin", async () => {
  const background = await loadBackground();

  const response = await background.send(
    {
      type: "PASSKEY_INTERCEPTED",
      operation: "create",
      requestId: "passkey-1",
      pageUrl: "https://example.com/register",
      origin: "https://example.com",
      rpId: "evil.example",
    },
    { tab: { id: 99, url: "https://example.com/register" } }
  );

  assert.deepEqual(response, { ok: false, payload: { status: "rp_mismatch" } });
  assert.equal(background.tabMessages.length, 0);
});

for (const scenario of ["origin", "frame", "tab", "expiry"]) {
  test(`pending autofill cannot cross ${scenario}`, async () => {
    const background = await loadBackground();
    const pendingAutofill = { itemId: "item-1", nonce: "n", origin: "https://example.com", expiresAt: Date.now() + 20000 };
    assert.equal((await background.send({ type: "SET_PENDING_AUTOFILL", pendingAutofill })).ok, true);
    const sender = { tab: { id: scenario === "tab" ? 43 : 42 }, frameId: scenario === "frame" ? 1 : 0,
      url: scenario === "origin" ? "http://example.com/password" : "https://example.com/password" };
    if (scenario === "expiry") background.sessionStorage.get("vaultmasterPendingAutofill")["42:0"].expiresAt = Date.now() - 1;
    const response = await background.send({ type: "GET_PENDING_AUTOFILL" }, sender);
    assert.equal(response.payload.pendingAutofill, null);
  });
}

test("rejects pending state claiming another origin", async () => {
  const background = await loadBackground();
  const response = await background.send({ type: "SET_PENDING_AUTOFILL", pendingAutofill: {
    itemId: "item-1", nonce: "n", origin: "https://other.test", expiresAt: Date.now() + 20000,
  } });
  assert.equal(response.ok, false);
  assert.equal(background.sessionStorage.size, 0);
});

const capturedCredential = { title: "Example", url: "https://example.com", username: "octo", password: "captured-secret" };

test("encrypts a submit snapshot and saves only after explicit confirmation", async () => {
  const background = await loadBackground({ tabResponse: { ok: true, payload: { status: "created" } } });
  assert.equal((await background.send({ type: "CAPTURE_LOGIN", credential: capturedCredential })).payload.status, "captured");
  assert.equal(background.tabMessages.length, 0);
  const stored = background.sessionStorage.get("vaultmasterPendingSaves")["42:0"];
  assert.equal(JSON.stringify(stored).includes(capturedCredential.password), false);
  assert.ok(stored.ciphertext);
  const draft = (await background.send({ type: "GET_PENDING_LOGIN_SAVE" })).payload.draft;
  assert.equal("key" in draft, false);
  assert.equal("ciphertext" in draft, false);
  assert.equal("password" in draft, false);
  assert.equal((await background.send({ type: "CONFIRM_LOGIN_SAVE", draftId: "wrong" })).ok, false);
  assert.equal(background.tabMessages.length, 0);
  assert.equal((await background.send({ type: "CONFIRM_LOGIN_SAVE", draftId: draft.id })).payload.status, "created");
  assert.deepEqual(background.tabMessages[0].credential, capturedCredential);
  assert.equal((await background.send({ type: "GET_PENDING_LOGIN_SAVE" })).payload.draft, null);
});

for (const scenario of ["origin", "frame", "tab", "expiry", "dismiss"]) {
  test(`pending save respects ${scenario}`, async () => {
    const background = await loadBackground();
    await background.send({ type: "CAPTURE_LOGIN", credential: capturedCredential });
    const draft = (await background.send({ type: "GET_PENDING_LOGIN_SAVE" })).payload.draft;
    if (scenario === "expiry") background.sessionStorage.get("vaultmasterPendingSaves")["42:0"].expiresAt = Date.now() - 1;
    if (scenario === "dismiss") await background.send({ type: "DISMISS_LOGIN_SAVE", draftId: draft.id });
    const sender = { tab: { id: scenario === "tab" ? 43 : 42 }, frameId: scenario === "frame" ? 1 : 0,
      url: scenario === "origin" ? "https://evil.test" : "https://example.com/success" };
    assert.equal((await background.send({ type: "GET_PENDING_LOGIN_SAVE" }, sender)).payload.draft, null);
    assert.equal(background.tabMessages.length, 0);
  });
}

test("never-save hosts are ignored and failed saves retain the draft for retry", async () => {
  const background = await loadBackground({ tabResponse: { ok: true, payload: { status: "locked" } } });
  await chrome.storage.local.set({ vaultmasterNeverSaveHosts: ["example.com"] });
  assert.equal((await background.send({ type: "CAPTURE_LOGIN", credential: capturedCredential })).payload.status, "ignored");
  await chrome.storage.local.set({ vaultmasterNeverSaveHosts: [] });
  await background.send({ type: "CAPTURE_LOGIN", credential: capturedCredential });
  const draft = (await background.send({ type: "GET_PENDING_LOGIN_SAVE" })).payload.draft;
  assert.equal((await background.send({ type: "CONFIRM_LOGIN_SAVE", draftId: draft.id })).payload.status, "locked");
  assert.equal((await background.send({ type: "GET_PENDING_LOGIN_SAVE" })).payload.draft.id, draft.id);
});

for (const type of ["GET_LOGIN_CREDENTIAL", "GET_PASSWORD_FOR_FILL", "VALIDATE_CREDENTIAL_DOMAIN"]) {
  test(`${type} rejects an origin supplied by a different site`, async () => {
    const background = await loadBackground();
    const response = await background.send({ type, itemId: "item-1", pageUrl: "https://trusted.test/login", expectedUrl: "https://trusted.test/login" });
    assert.equal(response.ok, false);
    assert.equal(background.tabMessages.length, 0);
  });
}

test("credential lookup uses the actual frame document, not the claimed path", async () => {
  const background = await loadBackground();
  await background.send({ type: "GET_LOGIN_CREDENTIAL", itemId: "item-1", pageUrl: "https://example.com/claimed" }, {
    tab: { id: 42, url: "https://example.com/top" }, url: "https://example.com/actual", frameId: 3,
  });
  assert.equal(background.tabMessages[0].pageUrl, "https://example.com/actual");
});

for (const sender of [{}, { tab: { id: 42 }, url: "about:blank" }, { tab: { id: 42 }, url: "https://example.com", documentLifecycle: "cached" }]) {
  test(`credential lookup rejects a missing or inactive document: ${JSON.stringify(sender)}`, async () => {
    const background = await loadBackground();
    assert.equal((await background.send({ type: "GET_LOGIN_CREDENTIAL", itemId: "item-1", pageUrl: "https://example.com" }, sender)).ok, false);
    assert.equal(background.tabMessages.length, 0);
  });
}

for (const type of ['LIST_AUTOFILL_TARGETS', 'FILL_AUTOFILL_TARGET']) {
  test(`${type} accepts only the extension popup sender`, async () => {
    const background = await loadBackground();
    for (const sender of [{ tab: { id: 42 }, url: 'https://example.com' },
      { id: 'other-extension', url: 'chrome-extension://fixture-extension/popup.html' }]) {
      assert.equal((await background.send({ type, tabId: 42, itemId: 'item-1' }, sender)).ok, false);
    }
    assert.equal(background.tabMessages.length, 0);
  });
}

for (const sender of [
  { tab: { id: 42, url: 'https://other.test' }, url: 'https://example.com', frameId: 3 },
  { tab: { id: 42 }, url: 'https://example.com', origin: 'null' },
  { tab: { id: 42 }, url: 'https://example.com', origin: 'https://evil.test' },
  { tab: { id: 42 }, url: 'https://example.com', documentId: 'replaced-document' },
]) {
  test(`rejects cross-origin, opaque or stale source: ${JSON.stringify(sender)}`, async () => {
    const background = await loadBackground();
    assert.equal((await background.send({ type: 'GET_LOGIN_CREDENTIAL', itemId: 'item-1', pageUrl: sender.url, forceFill: true }, sender)).ok, false);
    assert.equal(background.tabMessages.length, 0);
  });
}

test('same-origin descendants inside a foreign ancestor are unsupported', async () => {
  const frames = [
    { frameId: 0, documentId: 'main', url: 'https://example.com', documentLifecycle: 'active' },
    { frameId: 1, documentId: 'foreign', parentFrameId: 0, parentDocumentId: 'main', url: 'https://evil.test', documentLifecycle: 'active' },
    { frameId: 2, documentId: 'child', parentFrameId: 1, parentDocumentId: 'foreign', url: 'https://example.com', documentLifecycle: 'active' },
  ];
  const background = await loadBackground({ frames });
  assert.equal((await background.send({ type: 'GET_LOGIN_CREDENTIAL', itemId: 'item-1', pageUrl: 'https://example.com' },
    { tab: { id: 42 }, frameId: 2, documentId: 'child', url: 'https://example.com' })).ok, false);
  assert.equal(background.tabMessages.length, 0);
});

test('rechecks the browser document after asynchronous vault work before returning a secret', async () => {
  const frames = [{ frameId: 0, documentId: 'main', url: 'https://example.com/login', documentLifecycle: 'active' }];
  const background = await loadBackground({ frames, onVaultRequest: () => { frames[0].documentLifecycle = 'cached'; },
    tabResponse: { ok: true, payload: { status: 'ready', credential: { password: 'must-not-return' } } } });
  const response = await background.send({ type: 'GET_LOGIN_CREDENTIAL', itemId: 'item-1', pageUrl: frames[0].url });
  assert.equal(response.ok, false);
  assert.equal(JSON.stringify(response).includes('must-not-return'), false);
});
