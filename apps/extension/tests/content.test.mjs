import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { JSDOM } from "jsdom";

async function loadContent({ credential, domainValid = true, state = {} } = {}) {
  const dom = new JSDOM(
    `<!doctype html><html><body>
      <form>
        <input id="email" name="email" type="email" autocomplete="username">
        <input id="password" name="password" type="password" autocomplete="current-password">
      </form>
    </body></html>`,
    { url: "https://example.com/login", runScripts: "outside-only", pretendToBeVisual: true }
  );
  const runtimeMessages = [];
  const listeners = [];

  Object.defineProperty(dom.window.HTMLElement.prototype, "getBoundingClientRect", {
    value() {
      return { width: 200, height: 32, top: 0, right: 200, bottom: 32, left: 0 };
    },
  });

  dom.window.chrome = {
    runtime: {
      lastError: null,
      getURL: (path) => `chrome-extension://vaultmaster/${path}`,
      onMessage: { addListener: (listener) => listeners.push(listener) },
      sendMessage: (payload, callback) => {
        runtimeMessages.push(payload);
        if (payload.type === "SET_PENDING_AUTOFILL") state.pending = payload.pendingAutofill;
        if (payload.type === "CLEAR_PENDING_AUTOFILL") state.pending = null;
        if (payload.type === "GET_PENDING_AUTOFILL") {
          callback({ ok: true, payload: { pendingAutofill: state.pending } });
          return;
        }
        callback(state.locked && payload.type === "GET_LOGIN_CREDENTIAL"
          ? { ok: true, payload: { status: "locked" } }
          : resolveRuntimeResponse(payload, { credential, domainValid }));
      },
    },
  };

  dom.window.VaultMasterFormDetector = {
    detectCardFormContext: () => null,
    detectIdentityFormContext: () => null,
  };

  const source = await readFile(resolve("src/content.js"), "utf8");
  dom.window.eval(source);

  return {
    window: dom.window,
    runtimeMessages,
    send(message) {
      return new Promise((resolve) => {
        for (const listener of listeners) {
          if (listener(message, {}, resolve) === true) {
            return;
          }
        }
        assert.fail(`No listener handled ${message.type}`);
      });
    },
  };
}

function resolveRuntimeResponse(payload, { credential, domainValid }) {
  if (payload.type === "LIST_LOGIN_SUGGESTIONS") {
    return {
      ok: true,
      payload: {
        status: "ready",
        suggestions: credential
          ? [
              {
                itemId: credential.itemId,
                title: credential.title,
                username: credential.username,
                url: "https://example.com",
                matchScore: 100,
              },
            ]
          : [],
      },
    };
  }

  if (payload.type === "GET_LOGIN_CREDENTIAL") {
    return {
      ok: true,
      payload: domainValid || payload.forceFill
        ? {
            status: "ready",
            credential,
          }
        : {
            status: "domain_mismatch",
            itemId: payload.itemId,
          },
    };
  }

  if (payload.type === "VALIDATE_CREDENTIAL_DOMAIN") {
    return {
      ok: true,
      payload: { valid: domainValid },
    };
  }

  if (payload.type === "PASSKEY_INTERCEPTED") {
    return {
      ok: true,
      payload: {
        status: "candidates_available",
        rpId: payload.rpId || "example.com",
        candidates: [{ itemId: "passkey-1", title: "Example Passkey", username: "octo", rpId: "example.com" }],
        message: "VaultMaster found matching stored passkey metadata. Select one only after confirming this site; cryptographic signing is not implemented in this bridge yet.",
      },
    };
  }

  return { ok: true, payload: { status: "ready", suggestions: [] } };
}

test("fills a credential after an explicit extension message", async () => {
  const content = await loadContent({
    credential: {
      itemId: "item-1",
      title: "GitHub",
      username: "octo",
      password: "secret-password",
      hasTotp: false,
    },
  });
  await content.send({ type: "TRIGGER_AUTOFILL" });

  const response = await content.send({ type: "FILL_LOGIN_CREDENTIAL", itemId: "item-1" });

  assert.equal(response.ok, true);
  assert.deepEqual(Array.from(response.filledFields), ["identifier", "password"]);
  assert.equal(content.window.document.querySelector("#email").value, "octo");
  assert.equal(content.window.document.querySelector("#password").value, "secret-password");
  assert.equal(content.runtimeMessages.some((message) => message.type === "GET_LOGIN_CREDENTIAL"), true);
});

test("blocks panel autofill and shows a phishing warning when the domain is invalid", async () => {
  const content = await loadContent({
    domainValid: false,
    credential: {
      itemId: "item-1",
      title: "GitHub",
      username: "octo",
      password: "secret-password",
      hasTotp: false,
    },
  });

  content.window.document.querySelector("#email").focus();
  await new Promise((resolve) => content.window.setTimeout(resolve, 300));

  const fillButton = content.window.document.querySelector("[data-action='fill']");
  assert.ok(fillButton);
  fillButton.click();
  await new Promise((resolve) => content.window.setTimeout(resolve, 0));

  assert.equal(content.window.document.querySelector("#password").value, "");
  assert.match(content.window.document.querySelector("#vaultmaster-inline-autofill").textContent, /Güvenlik Uyarısı/);
  assert.equal(content.runtimeMessages.some((message) => message.type === "GET_LOGIN_CREDENTIAL"), true);
  assert.equal(content.runtimeMessages.some((message) => message.type === "VALIDATE_CREDENTIAL_DOMAIN"), false);
});

test("relays page-world passkey requests with consent-only messaging", async () => {
  const content = await loadContent();

  content.window.dispatchEvent(
    new content.window.MessageEvent("message", {
      source: content.window,
      origin: "https://example.com",
      data: {
        source: "vaultmaster-passkey-injected",
        type: "VM_PASSKEY_INTERCEPTED",
        operation: "get",
        requestId: "passkey-1",
        payload: { rpId: "example.com", origin: "https://example.com" },
      },
    })
  );

  await new Promise((resolve) => content.window.setTimeout(resolve, 0));

  const passkeyMessage = content.runtimeMessages.find((message) => message.type === "PASSKEY_INTERCEPTED");
  assert.equal(passkeyMessage.operation, "get");
  assert.equal(passkeyMessage.rpId, "example.com");
  assert.equal(passkeyMessage.origin, "https://example.com");
  const notice = content.window.document.querySelector("#vaultmaster-passkey-notice");
  assert.match(notice.textContent, /cryptographic signing is not implemented|imzalama/i);
  assert.match(notice.textContent, /Example Passkey/);
  notice.querySelector("[data-action='select-passkey']").click();
  assert.match(notice.textContent, /imzalı assertion olarak döndürmez/i);
});

const loginCredential = { itemId: "item-1", title: "Example", username: "octo", password: "secret-password", hasTotp: false };

test("checks the vault again when filling after it locks", async (t) => {
  const state = {};
  const content = await loadContent({ credential: loginCredential, state });
  t.after(() => content.window.close());
  assert.equal((await content.send({ type: "FILL_LOGIN_CREDENTIAL", itemId: "item-1" })).ok, true);
  content.window.document.querySelector("#password").value = "";
  state.locked = true;
  assert.equal((await content.send({ type: "FILL_LOGIN_CREDENTIAL", itemId: "item-1" })).ok, false);
  assert.equal(content.window.document.querySelector("#password").value, "");
  assert.equal(content.runtimeMessages.filter(m => m.type === "GET_LOGIN_CREDENTIAL").length, 2);
});

for (const locked of [false, true]) {
  test(`two-step login survives a new document and respects locked=${locked}`, async (t) => {
    const state = {};
    const first = await loadContent({ credential: loginCredential, state });
    t.after(() => first.window.close());
    first.window.document.querySelector("#password").remove();
    assert.equal((await first.send({ type: "FILL_LOGIN_CREDENTIAL", itemId: "item-1" })).ok, true);
    assert.equal(state.pending.itemId, "item-1");
    assert.equal(JSON.stringify(state.pending).includes(loginCredential.password), false);
    first.window.close();
    state.locked = locked;
    const next = await loadContent({ credential: loginCredential, state });
    t.after(() => next.window.close());
    await new Promise(resolve => next.window.setTimeout(resolve, 600));
    assert.equal(next.window.document.querySelector("#password").value, locked ? "" : loginCredential.password);
    assert.equal(state.pending, null);
    assert.ok(next.runtimeMessages.some(m => m.type === "GET_LOGIN_CREDENTIAL"));
  });
}
