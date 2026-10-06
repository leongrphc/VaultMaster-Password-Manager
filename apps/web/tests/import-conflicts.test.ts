import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, expect, test } from "vitest";
import { vi } from "vitest";
import { createVaultKey, exportMasterKeyBase64, decryptJSON } from "@vaultmaster/crypto";
import { legacyImportSnapshot, reviewImport, resolveImport, type ImportState } from "../src/lib/import-conflicts";
const data = { type: "login", title: "Synthetic", url: "https://example.test/login", username: "CaseSensitive", password: "DO-NOT-REPORT", tags: ["work", "personal"] };
const guard = () => {};
beforeEach(() => vi.stubGlobal("crypto", webcrypto));
afterEach(() => vi.unstubAllGlobals());
async function fixture() {
  const key = await createVaultKey(), base64 = await exportMasterKeyBase64(key);
  const snapshot = await legacyImportSnapshot({ items: [{ data }] }, base64, guard);
  const current: ImportState = { state: "a".repeat(64), folders: [], items: snapshot.items.map(item => ({ ...item, _count: { versions: 0, attachments: 0 } })) };
  const body = { backupId: crypto.randomUUID(), snapshot };
  return { key, base64, current, body };
}
test("exact equality ignores encryption randomness, object order and tag order; metadata and secrets remain private", async () => {
  const { base64, current } = await fixture();
  const snapshot = await legacyImportSnapshot({ version: "2.0", exportDate: new Date().toISOString(), itemCount: 2, folderCount: 0, items: [
    { data: { ...data, tags: ["personal", "work"] } }, { data },
  ] }, base64, guard);
  expect(snapshot.items[0]!.encryptedData).not.toBe(current.items[0]!.encryptedData);
  const review = await reviewImport({ backupId: crypto.randomUUID(), snapshot }, current, base64, guard);
  expect(review.rows.map(row => row.kind)).toEqual(["exact", "exact"]);
  expect(resolveImport(review, {}, false).snapshot.items).toHaveLength(0);
  expect(JSON.stringify(review)).not.toContain(data.password);
  expect(JSON.stringify(review)).not.toContain(data.username);
  expect(JSON.stringify(review)).not.toContain(data.url);
});
test("same-origin/case-sensitive account identity finds password updates and renamed entries; overwrite requires explicit approval", async () => {
  const { base64, current, key } = await fixture();
  const snapshot = await legacyImportSnapshot({ items: [{ data: { ...data, password: "changed", url: "https://example.test/new" } }, { data: { ...data, title: "Renamed" } }, { data: { ...data, username: "casesensitive" } }] }, base64, guard);
  const review = await reviewImport({ backupId: crypto.randomUUID(), snapshot }, current, base64, guard);
  expect(review.rows.map(row => row.kind)).toEqual(["same-login", "renamed", "new"]);
  expect(resolveImport(review, {}, false).snapshot.items).toHaveLength(1);
  expect(() => resolveImport(review, { 0: "replace" }, false)).toThrow();
  const resolved = resolveImport(review, { 0: "replace", 1: "keep-both" }, true);
  expect(resolved.review!.replacements[snapshot.items[0]!.id]).toBe(current.items[0]!.id);
  expect(await decryptJSON(resolved.snapshot.items[0]!.encryptedData, resolved.snapshot.items[0]!.iv, key)).toMatchObject({ password: "changed" });
});
test("ambiguous targets, trash and backup attachments cannot be overwritten", async () => {
  const { base64, current } = await fixture();
  current.items[0]!.deletedAt = new Date().toISOString();
  const snapshot = await legacyImportSnapshot({ items: [{ data: { ...data, password: "changed" } }] }, base64, guard);
  let review = await reviewImport({ backupId: crypto.randomUUID(), snapshot }, current, base64, guard);
  expect(review.rows[0]!.replaceAllowed).toBe(false);
  current.items.push({ ...current.items[0]!, id: crypto.randomUUID(), deletedAt: null });
  review = await reviewImport({ backupId: crypto.randomUUID(), snapshot }, current, base64, guard);
  expect(review.rows[0]!.replaceAllowed).toBe(false);
  expect(() => resolveImport(review, { 0: "replace" }, true)).toThrow();
  current.items = [current.items[1]!];
  snapshot.items[0]!.versions.push({ id: crypto.randomUUID(), encryptedData: snapshot.items[0]!.encryptedData, iv: snapshot.items[0]!.iv, folderId: null, favorite: false, reason: "update", createdAt: new Date().toISOString() });
  review = await reviewImport({ backupId: crypto.randomUUID(), snapshot }, current, base64, guard);
  expect(review.rows[0]!.replaceAllowed).toBe(false);
  expect(resolveImport(review, { 0: "keep-both" }, false).snapshot.items[0]!.versions).toHaveLength(1);
});
test("malformed/unsupported records, unknown fields and broken references fail without secret-bearing errors", async () => {
  const { base64, current, body } = await fixture();
  for (const payload of [{ items: [{ data: { ...data, type: "future" } }] }, { items: [{ data: { ...data, privateUnknown: data.password } }] }, { items: [{ data, folderId: crypto.randomUUID() }] }, { items: [{ data: { type: "login", title: data.password } }] }]) {
    await expect(legacyImportSnapshot(payload, base64, guard)).rejects.toThrow("İçe aktarma doğrulanamadı");
  }
  body.snapshot.items[0]!.encryptedData = "broken";
  await expect(reviewImport(body, current, base64, guard)).rejects.toThrow("İçe aktarma doğrulanamadı");
  await expect(reviewImport(body, current, base64, () => { throw new Error("locked"); })).rejects.toThrow("locked");
});
test("folders reuse only an unambiguous normalized name; tags are retained without merging", async () => {
  const { base64, current } = await fixture();
  const id = crypto.randomUUID(), date = new Date().toISOString();
  current.folders = [{ id: crypto.randomUUID(), name: "Work", createdAt: date, updatedAt: date }];
  const snapshot = await legacyImportSnapshot({ folders: [{ id, name: " work " }], items: [{ data, folderId: id }] }, base64, guard);
  let review = await reviewImport({ backupId: crypto.randomUUID(), snapshot }, current, base64, guard);
  expect(review.body.review!.folderMap[id]).toBe(current.folders[0]!.id);
  current.folders.push({ ...current.folders[0]!, id: crypto.randomUUID() });
  review = await reviewImport({ backupId: crypto.randomUUID(), snapshot }, current, base64, guard);
  expect(review.body.review!.folderMap).toEqual({});
});

test("full backup empty folders survive review, and ambiguous names cannot establish exact folder equality", async () => {
  const { base64, current, body } = await fixture();
  const date = new Date().toISOString(), sourceFolder = crypto.randomUUID();
  const emptyFolder = { id: crypto.randomUUID(), name: "Empty", createdAt: date, updatedAt: date };
  body.snapshot.folders = [{ id: sourceFolder, name: "Ambiguous", createdAt: date, updatedAt: date }, emptyFolder];
  body.snapshot.items[0]!.folderId = sourceFolder;
  current.folders = [1, 2].map(() => ({ id: crypto.randomUUID(), name: "Ambiguous", createdAt: date, updatedAt: date }));
  current.items[0]!.folderId = current.folders[0]!.id;
  const review = await reviewImport(body, current, base64, guard, true);
  expect(review.rows[0]!.kind).toBe("renamed");
  const resolved = resolveImport(review, {}, false);
  expect(resolved.snapshot.items).toHaveLength(0);
  expect(resolved.snapshot.folders).toEqual([emptyFolder]);
});
