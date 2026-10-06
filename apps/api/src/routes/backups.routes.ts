import { securityNotification } from "../utils/security-notifications.js";
import { durableLimit } from "../middleware/durable-limit.js";
import { createHash, randomUUID } from "node:crypto";
import { Router, type Request, type Response, type NextFunction } from "express";
import { Prisma } from "@prisma/client";
import { countBackup, MAX_BACKUP_SNAPSHOT_BYTES, MAX_CHUNKED_SNAPSHOT_BYTES, MAX_BACKUP_TRANSFER_BYTES, BACKUP_TRANSFER_CHUNK_BYTES, backupTransferSchema, backupTransferChunkSchema, personalSnapshotSchema, restoreBackupSchema } from "@vaultmaster/shared";
import { prisma } from "../config/prisma.js";
import { authMiddleware } from "../middleware/auth.js";
import { logAuditEvent } from "../utils/audit-log.js";

const router: Router = Router();
router.use(authMiddleware);
router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
const chunkLimiter = durableLimit("backup-chunks", 400, true);
router.use("/transfers/:id/chunks", chunkLimiter);
class BackupTooLarge extends Error {}

const importSelect = { id: true, encryptedData: true, iv: true, folderId: true, favorite: true,
  deletedAt: true, createdAt: true, updatedAt: true,
  _count: { select: { versions: true, attachments: true } } } as const;
async function importState(tx: Prisma.TransactionClient, userId: string) {
  const sizes = await tx.$queryRaw<Array<{ bytes: bigint }>>`SELECT COALESCE(SUM(OCTET_LENGTH("encryptedData")), 0) AS bytes FROM vault_items WHERE "userId" = ${userId}`;
  if (Number(sizes[0]!.bytes) > MAX_CHUNKED_SNAPSHOT_BYTES) throw new BackupTooLarge();
  if (await tx.vaultItem.count({ where: { userId } }) > 10000 || await tx.folder.count({ where: { userId } }) > 10000) throw new BackupTooLarge();
  const items = await tx.vaultItem.findMany({ where: { userId }, orderBy: { id: "asc" }, select: importSelect });
  const folders = await tx.folder.findMany({ where: { userId }, orderBy: { id: "asc" },
    select: { id: true, name: true, createdAt: true, updatedAt: true } });
  const serialized = JSON.stringify({ items, folders });
  if (Buffer.byteLength(serialized) > MAX_CHUNKED_SNAPSHOT_BYTES) throw new BackupTooLarge();
  return { items, folders, state: createHash("sha256").update(serialized).digest("hex") };
}
router.get("/import-state", async (req, res, next) => {
  try {
    const data = await prisma.$transaction(tx => importState(tx, req.user!.userId),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30000 });
    res.json({ success: true, data });
  } catch (error) {
    if (error instanceof BackupTooLarge) { res.status(413).json({ success: false, error: "Import review size limit exceeded" }); return; }
    next(error);
  }
});
class ImportConflict extends Error {}

router.get("/snapshot", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const chunked = req.query.version === "4";
    const limit = chunked ? MAX_CHUNKED_SNAPSHOT_BYTES : MAX_BACKUP_SNAPSHOT_BYTES;
    const snapshot = await prisma.$transaction(async tx => {
      // Reject large accounts before loading their encrypted blobs into memory.
      const sizes = await tx.$queryRaw<Array<{ bytes: bigint }>>`
        SELECT COALESCE((SELECT SUM(OCTET_LENGTH("encryptedData")) FROM vault_items WHERE "userId" = ${userId}), 0)
          + COALESCE((SELECT SUM(OCTET_LENGTH(v."encryptedData")) FROM vault_item_versions v JOIN vault_items i ON i.id = v."vaultItemId" WHERE i."userId" = ${userId}), 0)
          + COALESCE((SELECT SUM(OCTET_LENGTH("encryptedBlob") + OCTET_LENGTH("encryptedMetadata")) FROM attachments WHERE "userId" = ${userId}), 0) AS bytes
      `;
      if (Number(sizes[0]!.bytes) > limit ||
          await tx.vaultItem.count({ where: { userId } }) > 10000 || await tx.folder.count({ where: { userId } }) > 10000) throw new BackupTooLarge();
      const folders = await tx.folder.findMany({ where: { userId }, orderBy: { id: "asc" },
        select: { id: true, name: true, createdAt: true, updatedAt: true } });
      const items = await tx.vaultItem.findMany({ where: { userId }, orderBy: { id: "asc" },
        select: { id: true, encryptedData: true, iv: true, folderId: true, favorite: true, deletedAt: true,
          createdAt: true, updatedAt: true,
          versions: { orderBy: { createdAt: "asc" }, select: { id: true, encryptedData: true, iv: true, folderId: true,
            favorite: true, reason: true, createdAt: true } },
          attachments: { orderBy: { id: "asc" }, select: { id: true, encryptedMetadata: true, metadataIv: true,
            encryptedBlob: true, blobIv: true, size: true, createdAt: true, updatedAt: true } },
        } });
      const serialized = JSON.stringify({ folders, items });
      if (Buffer.byteLength(serialized) > limit) throw new BackupTooLarge();
      return personalSnapshotSchema.parse(JSON.parse(serialized));
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30000 });
    await logAuditEvent({ userId, action: "vault.backup.export", status: "success" });
    res.setHeader("Cache-Control", "no-store");
    const data = { backupId: randomUUID(), exportedAt: new Date().toISOString(), sourceEmail: req.user!.email, snapshot };
    if (!chunked) { await securityNotification(prisma, userId, "vault.backup.export"); res.json({ success: true, data }); return; }
    const bytes = Buffer.from(JSON.stringify(data));
    if (bytes.length > MAX_BACKUP_TRANSFER_BYTES) throw new BackupTooLarge();
    const chunks: Array<{ index: number; data: string }> = [];
    for (let offset = 0; offset < bytes.length; offset += BACKUP_TRANSFER_CHUNK_BYTES) {
      chunks.push({ index: chunks.length, data: bytes.subarray(offset, offset + BACKUP_TRANSFER_CHUNK_BYTES).toString("base64") });
    }
    const transfer = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
      await tx.backupTransfer.deleteMany({ where: { userId, OR: [{ expiresAt: { lt: new Date() } }, { direction: "export" }] } });
      await securityNotification(tx, userId, "vault.backup.export");
      return tx.backupTransfer.create({ data: { userId, direction: "export", totalBytes: bytes.length, chunkCount: chunks.length,
        expiresAt: new Date(Date.now() + 3600000), chunks: { create: chunks } } });
    }, { timeout: 60000 });
    res.json({ success: true, data: { transferId: transfer.id, totalBytes: transfer.totalBytes, chunkCount: transfer.chunkCount } });
  } catch (error) {
    if (error instanceof BackupTooLarge) { res.status(413).json({ success: false, error: "Kasa seçilen yedek sürümünün boyut sınırını aşıyor. Hiçbir içerik atlanmadı." }); return; }
    next(error);
  }
});

async function restore(req: Request, res: Response, next: NextFunction, chunked = false) {
  try {
    if (Buffer.byteLength(JSON.stringify(req.body)) > (chunked ? MAX_BACKUP_TRANSFER_BYTES : MAX_BACKUP_SNAPSHOT_BYTES)) {
      res.status(413).json({ success: false, error: "Yedek geri yükleme boyut sınırını aşıyor." }); return;
    }
    const { backupId, snapshot, review } = restoreBackupSchema.parse(req.body);
    const importDigest = review ? createHash("sha256").update(JSON.stringify(req.body)).digest("hex") : null;
    if (Buffer.byteLength(JSON.stringify(snapshot)) > (chunked ? MAX_CHUNKED_SNAPSHOT_BYTES : MAX_BACKUP_SNAPSHOT_BYTES)) throw new BackupTooLarge();
    const userId = req.user!.userId;
    const counts = countBackup(snapshot);
    const result = await prisma.$transaction(async tx => {
      // Serialize imports for this account so a retry (including a lost HTTP
      // response) cannot duplicate an already committed backup.
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
      const previous = await tx.backupRestore.findUnique({ where: { userId_backupId: { userId, backupId } } });
      if (previous) {
        const stored = previous.counts as unknown as Record<string, number | string>;
        if (review && stored.importDigest !== importDigest) throw new ImportConflict();
        const { importDigest: _digest, ...publicCounts } = stored;
        return { alreadyRestored: true, counts: publicCounts };
      }
      const current = review ? await importState(tx, userId) : null;
      if (review && current?.state !== review.state) throw new ImportConflict();
      const sourceFolders = new Set(snapshot.folders.map(folder => folder.id));
      const sourceItems = new Set(snapshot.items.map(item => item.id));
      const replacementTargets = Object.values(review?.replacements ?? {});
      if (review && (new Set(replacementTargets).size !== replacementTargets.length ||
        (replacementTargets.length > 0 && !review.overwriteApproved) ||
        Object.entries(review.folderMap).some(([source, target]) => !sourceFolders.has(source) || !current!.folders.some(folder => folder.id === target)) ||
        Object.entries(review.replacements).some(([source, target]) => !sourceItems.has(source) || !current!.items.some(item => item.id === target && !item.deletedAt) ||
          snapshot.items.some(item => item.id === source && (item.deletedAt || item.versions.length || item.attachments.length))))) throw new ImportConflict();
      const folderIds = new Map(snapshot.folders.map(folder => [folder.id, review?.folderMap[folder.id] ?? randomUUID()]));
      if (snapshot.folders.length) await tx.folder.createMany({ data: snapshot.folders.filter(folder => !review?.folderMap[folder.id]).map(folder => ({ ...folder,
        id: folderIds.get(folder.id)!, userId, createdAt: new Date(folder.createdAt), updatedAt: new Date(folder.updatedAt) })) });
      const items: Prisma.VaultItemCreateManyInput[] = [];
      const versions: Prisma.VaultItemVersionCreateManyInput[] = [];
      const attachments: Prisma.AttachmentCreateManyInput[] = [];
      for (const item of snapshot.items) {
        const { versions: history, attachments: files, ...fields } = item;
        const target = review?.replacements[item.id];
        const itemId = target ?? randomUUID();
        if (target) {
          const before = current!.items.find(entry => entry.id === target)!;
          await tx.vaultItemVersion.create({ data: { vaultItemId: target, encryptedData: before.encryptedData,
            iv: before.iv, folderId: before.folderId, favorite: before.favorite, reason: "import_before" } });
          await tx.vaultItem.update({ where: { id: target }, data: { encryptedData: item.encryptedData,
            iv: item.iv, folderId: item.folderId ? folderIds.get(item.folderId)! : null, favorite: item.favorite } });
          continue;
        }
        items.push({ ...fields, id: itemId, userId, folderId: item.folderId ? folderIds.get(item.folderId)! : null,
          createdAt: new Date(item.createdAt), updatedAt: new Date(item.updatedAt), deletedAt: item.deletedAt ? new Date(item.deletedAt) : null });
        versions.push(...history.map(version => ({ ...version, id: randomUUID(), vaultItemId: itemId,
          folderId: version.folderId ? folderIds.get(version.folderId) ?? null : null, createdAt: new Date(version.createdAt) })));
        attachments.push(...files.map(file => ({ ...file, id: randomUUID(), userId, vaultItemId: itemId,
          createdAt: new Date(file.createdAt), updatedAt: new Date(file.updatedAt) })));
      }
      if (items.length) await tx.vaultItem.createMany({ data: items });
      if (versions.length) await tx.vaultItemVersion.createMany({ data: versions });
      if (attachments.length) await tx.attachment.createMany({ data: attachments });
      await tx.backupRestore.create({ data: { userId, backupId, counts: { ...counts, ...(importDigest ? { importDigest } : {}) } } });
      return { alreadyRestored: false, counts };
    }, { timeout: 60000, maxWait: 10000, isolationLevel: review ? Prisma.TransactionIsolationLevel.Serializable : Prisma.TransactionIsolationLevel.ReadCommitted });
    await logAuditEvent({ userId, action: "vault.backup.restore", status: "success", metadata: { backupId, alreadyRestored: result.alreadyRestored } });
    res.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof ImportConflict || (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034")) {
      res.status(409).json({ success: false, error: "Import conflict. Review the current vault again; no changes committed." }); return;
    }
    if (error instanceof BackupTooLarge) { res.status(413).json({ success: false, error: "Backup size limit exceeded" }); return; }
    next(error);
  }
}
router.post("/restore", (req, res, next) => void restore(req, res, next));

router.post("/transfers", async (req, res, next) => {
  try {
    const manifest = backupTransferSchema.parse(req.body);
    const userId = req.user!.userId;
    const transfer = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
      await tx.backupTransfer.deleteMany({ where: { userId, expiresAt: { lt: new Date() } } });
      if (await tx.backupTransfer.count({ where: { userId, direction: "restore" } }) >= 2) return null;
      return tx.backupTransfer.create({ data: { ...manifest, userId, direction: "restore", expiresAt: new Date(Date.now() + 3600000) } });
    });
    if (!transfer) { res.status(429).json({ success: false, error: "Too many unfinished backup transfers" }); return; }
    res.json({ success: true, data: { transferId: transfer.id } });
  } catch (error) { next(error); }
});
router.get("/transfers/:id/chunks/:index", async (req, res, next) => {
  try {
    const transfer = await prisma.backupTransfer.findFirst({ where: { id: String(req.params.id), userId: req.user!.userId,
      direction: "export", expiresAt: { gt: new Date() } } });
    const index = Number(req.params.index);
    if (!transfer || !Number.isInteger(index) || index < 0 || index >= transfer.chunkCount) { res.status(404).json({ success: false, error: "Backup transfer not found or expired" }); return; }
    const chunk = await prisma.backupTransferChunk.findUniqueOrThrow({ where: { transferId_index: { transferId: transfer.id, index } } });
    res.setHeader("Cache-Control", "no-store");
    res.json({ success: true, data: { index: chunk.index, data: chunk.data } });
  } catch (error) { next(error); }
});
router.put("/transfers/:id/chunks", async (req, res, next) => {
  try {
    const chunk = backupTransferChunkSchema.parse(req.body);
    const result = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${req.user!.userId} FOR UPDATE`;
      const transfer = await tx.backupTransfer.findFirst({ where: { id: String(req.params.id), userId: req.user!.userId,
        direction: "restore", expiresAt: { gt: new Date() } } });
      if (!transfer) return 404;
      const expected = Math.min(BACKUP_TRANSFER_CHUNK_BYTES, transfer.totalBytes - chunk.index * BACKUP_TRANSFER_CHUNK_BYTES);
      const bytes = Buffer.from(chunk.data, "base64");
      if (chunk.index >= transfer.chunkCount || bytes.length !== expected || bytes.toString("base64") !== chunk.data) return 400;
      const previous = await tx.backupTransferChunk.findUnique({ where: { transferId_index: { transferId: transfer.id, index: chunk.index } } });
      if (previous) return previous.data === chunk.data ? 200 : 409;
      const count = await tx.backupTransferChunk.count({ where: { transferId: transfer.id } });
      if (chunk.index !== count) return 409;
      await tx.backupTransferChunk.create({ data: { ...chunk, transferId: transfer.id } });
      return 200;
    });
    res.status(result).json({ success: result === 200, error: result === 200 ? undefined : "Invalid or conflicting backup chunk" });
  } catch (error) { next(error); }
});
router.post("/transfers/:id/commit", async (req, res, next) => {
  try {
    const transfer = await prisma.backupTransfer.findFirst({ where: { id: String(req.params.id), userId: req.user!.userId,
      direction: "restore", expiresAt: { gt: new Date() } }, include: { chunks: { orderBy: { index: "asc" } } } });
    if (!transfer) { res.status(404).json({ success: false, error: "Backup transfer not found or expired" }); return; }
    if (transfer.chunks.length !== transfer.chunkCount || transfer.chunks.some((chunk, index) => chunk.index !== index)) {
      res.status(409).json({ success: false, error: "Incomplete backup transfer" }); return;
    }
    const bytes = Buffer.concat(transfer.chunks.map(chunk => Buffer.from(chunk.data, "base64")));
    if (bytes.length !== transfer.totalBytes) { res.status(400).json({ success: false, error: "Invalid backup transfer size" }); return; }
    try { req.body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
    catch { res.status(400).json({ success: false, error: "Invalid backup JSON" }); return; }
    await restore(req, res, next, true);
  } catch (error) { next(error); }
});
router.delete("/transfers/:id", async (req, res, next) => {
  try {
    await prisma.backupTransfer.deleteMany({ where: { id: String(req.params.id), userId: req.user!.userId } });
    res.json({ success: true });
  } catch (error) { next(error); }
});

export default router;
