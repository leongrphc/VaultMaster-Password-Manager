import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveMasterKey,
  exportMasterKeyBase64,
  importMasterKey,
  encrypt,
  decrypt,
  encryptJSON,
  decryptJSON,
  generatePassword,
  generatePassphrase,
  calculateStrength,
  getStrengthLabel,
  generateAuthHash,
} from "../dist/index.js";

test("encrypt/decrypt round-trip works with imported key", async () => {
  const masterKey = await deriveMasterKey("CorrectHorseBatteryStaple", "user@example.com");
  const exported = await exportMasterKeyBase64(masterKey);
  const imported = await importMasterKey(exported);

  const encrypted = await encrypt("vaultmaster-secret", imported);
  const decrypted = await decrypt(encrypted.ciphertext, encrypted.iv, imported);

  assert.equal(decrypted, "vaultmaster-secret");
});

test("encryptJSON/decryptJSON preserves structured payloads", async () => {
  const masterKey = await deriveMasterKey("AnotherStrongPassword!", "user@example.com");
  const payload = {
    type: "login",
    title: "Example",
    username: "user@example.com",
    password: "P@ssw0rd!",
    totpSecret: "JBSWY3DPEHPK3PXP",
    tags: ["work", "critical"],
    customFields: [
      {
        id: "tenant-id",
        label: "Tenant ID",
        value: "acme-prod",
        concealed: false,
      },
    ],
  };

  const encrypted = await encryptJSON(payload, masterKey);
  const decrypted = await decryptJSON(encrypted.ciphertext, encrypted.iv, masterKey);

  assert.deepEqual(decrypted, payload);
});

test("generatePassword respects requested character groups", () => {
  const password = generatePassword({
    length: 24,
    lowercase: true,
    uppercase: true,
    digits: true,
    special: true,
    excludeAmbiguous: true,
  });

  assert.equal(password.length, 24);
  assert.match(password, /[a-z]/);
  assert.match(password, /[A-Z]/);
  assert.match(password, /[0-9]/);
  assert.match(password, /[^a-zA-Z0-9]/);
  assert.equal(/[l1IO0|]/.test(password), false);
});

test("generatePassphrase respects word count and separator", () => {
  const passphrase = generatePassphrase({
    wordCount: 5,
    separator: ".",
    capitalize: false,
    includeNumber: false,
  });
  const words = passphrase.split(".");

  assert.equal(words.length, 5);
  assert.ok(words.every((word) => word.length > 0));
  assert.equal(/\d/.test(passphrase), false);
});

test("generatePassphrase applies capitalization and number option", () => {
  const passphrase = generatePassphrase({
    wordCount: 4,
    separator: "-",
    capitalize: true,
    includeNumber: true,
  });
  const words = passphrase.split("-");

  assert.equal(words.length, 4);
  assert.ok(words.every((word) => /^[A-Z]/.test(word)));
  assert.match(passphrase, /\d/);
});

test("password strength labelling stays consistent", () => {
  const weakScore = calculateStrength("1234");
  const strongScore = calculateStrength("Longer!Passw0rd#2026");

  assert.equal(getStrengthLabel(weakScore), "weak");
  assert.ok(strongScore > weakScore);
  assert.ok(["strong", "excellent"].includes(getStrengthLabel(strongScore)));
});

test("auth hash is deterministic for same key and password", async () => {
  const masterKey = await deriveMasterKey("CorrectHorseBatteryStaple", "user@example.com");

  const hashA = await generateAuthHash(masterKey, "CorrectHorseBatteryStaple");
  const hashB = await generateAuthHash(masterKey, "CorrectHorseBatteryStaple");

  assert.equal(hashA, hashB);
});

test("import content uses fresh randomized ciphertext and retains credentials, tags and whitespace without key leakage", async () => {
  const key = await deriveMasterKey("Synthetic-import-master", "synthetic@example.test");
  const payload = { type: "login", title: "Synthetic", username: " User ", password: " Secret ", tags: ["work"], customFields: [{ id: "id", label: "Synthetic", value: "Concealed", concealed: true }] };
  const first = await encryptJSON(payload, key), second = await encryptJSON(payload, key);
  assert.notEqual(first.ciphertext, second.ciphertext); assert.notEqual(first.iv, second.iv);
  assert.deepEqual(await decryptJSON(second.ciphertext, second.iv, key), payload);
  assert.ok(!JSON.stringify(second).includes(payload.password));
  assert.ok(!JSON.stringify(second).includes(await exportMasterKeyBase64(key)));
  await assert.rejects(decryptJSON(first.ciphertext, second.iv, key));
});

test('failed synthetic vault decryption emits no plaintext, ciphertext or key diagnostics', async () => {
  const output = [];
  const original = { log: console.log, error: console.error, info: console.info, warn: console.warn };
  for (const method of Object.keys(original)) console[method] = (...args) => output.push(args);
  try {
    const { createVaultKey, encryptJSON, decryptJSON } = await import('../dist/index.js');
    const one = await createVaultKey(), other = await createVaultKey();
    const encrypted = await encryptJSON({ password: 'synthetic-private' }, one);
    await assert.rejects(() => decryptJSON(encrypted.ciphertext, encrypted.iv, other));
    assert.equal(output.length, 0);
  } finally { Object.assign(console, original); }
});
