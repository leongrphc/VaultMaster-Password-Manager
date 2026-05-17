import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { JSDOM } from "jsdom";

async function loadDetector(html) {
  const dom = new JSDOM(html, { url: "https://example.com/login", runScripts: "outside-only" });
  Object.defineProperty(dom.window.HTMLElement.prototype, "getBoundingClientRect", {
    value() {
      return { width: 200, height: 32, top: 0, right: 200, bottom: 32, left: 0 };
    },
  });

  const source = await readFile(resolve("src/form-detector.js"), "utf8");
  dom.window.eval(source);
  return dom.window;
}

test("detects login forms from identifier and password fields", async () => {
  const window = await loadDetector(`
    <form>
      <input id="email" name="email" type="email" autocomplete="username">
      <input id="password" name="password" type="password" autocomplete="current-password">
    </form>
  `);

  const email = window.document.querySelector("#email");
  const context = window.VaultMasterFormDetector.detectLoginFormContext(email);

  assert.equal(context.type, "login");
  assert.equal(context.usernameInput, email);
  assert.equal(context.passwordInput, window.document.querySelector("#password"));
  assert.equal(context.anchorInput, email);
});

test("detects credit card forms only when enough card fields are visible", async () => {
  const window = await loadDetector(`
    <form>
      <input id="card-number" autocomplete="cc-number">
      <input id="card-name" autocomplete="cc-name">
      <input id="hidden" type="hidden" autocomplete="cc-csc">
    </form>
  `);

  const context = window.VaultMasterFormDetector.detectCardFormContext(window.document.querySelector("#card-number"));

  assert.equal(context.type, "credit_card");
  assert.equal(context.cardNumberInput, window.document.querySelector("#card-number"));
  assert.equal(context.cardholderNameInput, window.document.querySelector("#card-name"));
  assert.equal(context.cvvInput, null);
});

test("detects identity forms from contact fields", async () => {
  const window = await loadDetector(`
    <form>
      <input id="full-name" name="full-name">
      <input id="phone" name="phone" type="tel">
      <input id="address" name="address">
    </form>
  `);

  const context = window.VaultMasterFormDetector.detectIdentityFormContext(window.document.querySelector("#full-name"));

  assert.equal(context.type, "identity");
  assert.equal(context.fullNameInput, window.document.querySelector("#full-name"));
  assert.equal(context.phoneInput, window.document.querySelector("#phone"));
  assert.equal(context.addressInput, window.document.querySelector("#address"));
});
