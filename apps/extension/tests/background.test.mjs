import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

async function loadBackground({ vaultTab = { id: 7, windowId: 1 }, tabResponse = { ok: true, payload: { valid: true } } } = {}) {
  const listeners = [];
  const localStorage = new Map();
  const sessionStorage = new Map();
  const tabMessages = [];

  globalThis.chrome = {
    runtime: {
      lastError: null,
      onMessage: { addListener: (listener) => listeners.push(listener) },
      onInstalled: { addListener: () => undefined },
    },
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

  const source = await readFile(resolve("src/background.js"), "utf8");
  await import(`data:text/javascript,${encodeURIComponent(source)}#${Date.now()}-${Math.random()}`);

  return {
    tabMessages,
    sessionStorage,
    async send(message, sender = { tab: { id: 42 } }) {
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
      expiresAt: Date.now() + 20000,
      password: "secret-password",
      totp: "123456",
      totpCode: "654321",
      cvv: "123",
    },
  });

  assert.deepEqual(response, { ok: true });
  const stored = background.sessionStorage.get("vaultmasterPendingAutofill");
  assert.equal(stored["42"].itemId, "item-1");
  assert.equal(stored["42"].nonce, "nonce-1");
  assert.equal("password" in stored["42"], false);
  assert.equal("totp" in stored["42"], false);
  assert.equal("totpCode" in stored["42"], false);
  assert.equal("cvv" in stored["42"], false);
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
    { tab: { id: 99 } }
  );

  assert.deepEqual(response, { ok: true, payload: { valid: false } });
  assert.deepEqual(background.tabMessages[0], {
    type: "VM_VALIDATE_CREDENTIAL_DOMAIN_REQUEST",
    itemId: "item-1",
    pageUrl: "https://phishing.example/login",
    sourceTabId: 99,
  });
});
