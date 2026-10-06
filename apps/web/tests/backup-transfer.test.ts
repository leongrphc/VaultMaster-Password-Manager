import { expect, test } from "vitest";
import { BACKUP_TRANSFER_CHUNK_BYTES, MAX_BACKUP_TRANSFER_BYTES } from "@vaultmaster/shared";
import { decodeBackupTransfer, encodeBackupTransfer, retryBackupTransfer } from "../src/lib/backup-transfer";

test("chunk transport round-trips UTF-8 across chunk boundaries and retries a lost response", async () => {
  const body = { value: "ü".repeat(BACKUP_TRANSFER_CHUNK_BYTES) };
  const encoded = encodeBackupTransfer(body);
  let interrupted = false;
  const result = await decodeBackupTransfer(encoded.manifest, async index => {
    if (index === 1 && !interrupted) { interrupted = true; throw { status: 0 }; }
    return encoded.chunk(index);
  }, () => {});
  expect(result).toEqual(body);
  expect(interrupted).toBe(true);
});
test("transport rejects ordering, truncation and limits", async () => {
  const encoded = encodeBackupTransfer({ value: "test" });
  await expect(decodeBackupTransfer(encoded.manifest, async () => ({ ...encoded.chunk(0), index: 1 }), () => {})).rejects.toThrow();
  await expect(decodeBackupTransfer(encoded.manifest, async () => ({ index: 0, data: "YQ==" }), () => {})).rejects.toThrow();
  await expect(decodeBackupTransfer({ totalBytes: MAX_BACKUP_TRANSFER_BYTES + 1, chunkCount: 66 }, async () => {}, () => {})).rejects.toThrow();
});
test("retries are bounded, never retry HTTP rejection and stop on session lock", async () => {
  let calls = 0;
  await expect(retryBackupTransfer(async () => { calls++; throw { status: 0 }; }, () => {})).rejects.toEqual({ status: 0 });
  expect(calls).toBe(3);
  calls = 0;
  await expect(retryBackupTransfer(async () => { calls++; throw { status: 409 }; }, () => {})).rejects.toEqual({ status: 409 });
  expect(calls).toBe(1);
  await expect(retryBackupTransfer(async () => "unused", () => { throw new Error("locked"); })).rejects.toThrow("locked");
});
