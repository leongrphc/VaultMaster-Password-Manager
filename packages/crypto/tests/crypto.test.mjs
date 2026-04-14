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
