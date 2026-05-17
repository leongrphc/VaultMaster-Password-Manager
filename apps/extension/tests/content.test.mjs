import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { JSDOM } from "jsdom";

async function loadContent({ credential, domainValid = true } = {}) {
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
      onMessage: { addListener: (listener) => listeners.push(listener) },
      sendMessage: (payload, callback) => {
        runtimeMessages.push(payload);
        callback(resolveRuntimeResponse(payload, { credential, domainValid }));
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
      payload: {
        status: "ready",
        credential,
      },
    };
  }

  if (payload.type === "VALIDATE_CREDENTIAL_DOMAIN") {
    return {
      ok: true,
      payload: { valid: domainValid },
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
  assert.equal(content.runtimeMessages.some((message) => message.type === "VALIDATE_CREDENTIAL_DOMAIN"), true);
});
