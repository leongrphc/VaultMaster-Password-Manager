import { randomUUID } from "node:crypto";
import { Router, type Request, type Response, type NextFunction } from "express";
import { Prisma } from "@prisma/client";
import { countBackup, MAX_BACKUP_SNAPSHOT_BYTES, personalSnapshotSchema, restoreBackupSchema } from "@vaultmaster/shared";
import { prisma } from "../config/prisma.js";
import { authMiddleware } from "../middleware/auth.js";
import { logAuditEvent } from "../utils/audit-log.js";

const router: Router = Router();
router.use(authMiddleware);
class BackupTooLarge extends Error {}

router.get("/snapshot", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const snapshot = await prisma.$transaction(async tx => {
      // Reject large accounts before loading their encrypted blobs into memory.
      const sizes = await tx.$queryRaw<Array<{ bytes: bigint }>>`
        SELECT COALESCE((SELECT SUM(OCTET_LENGTH("encryptedData")) FROM vault_items WHERE "userId" = ${userId}), 0)
          + COALESCE((SELECT SUM(OCTET_LENGTH(v."encryptedData")) FROM vault_item_versions v JOIN vault_items i ON i.id = v."vaultItemId" WHERE i."userId" = ${userId}), 0)
          + COALESCE((SELECT SUM(OCTET_LENGTH("encryptedBlob") + OCTET_LENGTH("encryptedMetadata")) FROM attachments WHERE "userId" = ${userId}), 0) AS bytes
      `;
      if (Number(sizes[0]!.bytes) > MAX_BACKUP_SNAPSHOT_BYTES ||
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
      if (Buffer.byteLength(serialized) > MAX_BACKUP_SNAPSHOT_BYTES) throw new BackupTooLarge();
      return personalSnapshotSchema.parse(JSON.parse(serialized));
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30000 });
    await logAuditEvent({ userId, action: "vault.backup.export", status: "success" });
    res.setHeader("Cache-Control", "no-store");
    res.json({ success: true, data: { backupId: randomUUID(), exportedAt: new Date().toISOString(),
      sourceEmail: req.user!.email, snapshot } });
  } catch (error) {
    if (error instanceof BackupTooLarge) { res.status(413).json({ success: false, error: "Kasa bu yedek sürümünün 16 MiB sınırını aşıyor. Hiçbir içerik atlanmadı." }); return; }
    next(error);
  }
});

router.post("/restore", async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (Buffer.byteLength(JSON.stringify(req.body)) > MAX_BACKUP_SNAPSHOT_BYTES) {
      res.status(413).json({ success: false, error: "Yedek geri yükleme boyut sınırını aşıyor." }); return;
    }
    const { backupId, snapshot } = restoreBackupSchema.parse(req.body);
    const userId = req.user!.userId;
    const counts = countBackup(snapshot);
    const result = await prisma.$transaction(async tx => {
      // Serialize imports for this account so a retry (including a lost HTTP
      // response) cannot duplicate an already committed backup.
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
      const previous = await tx.backupRestore.findUnique({ where: { userId_backupId: { userId, backupId } } });
      if (previous) return { alreadyRestored: true, counts: previous.counts };
      const folderIds = new Map(snapshot.folders.map(folder => [folder.id, randomUUID()]));
      if (snapshot.folders.length) await tx.folder.createMany({ data: snapshot.folders.map(folder => ({ ...folder,
        id: folderIds.get(folder.id)!, userId, createdAt: new Date(folder.createdAt), updatedAt: new Date(folder.updatedAt) })) });
      const items: Prisma.VaultItemCreateManyInput[] = [];
      const versions: Prisma.VaultItemVersionCreateManyInput[] = [];
      const attachments: Prisma.AttachmentCreateManyInput[] = [];
      for (const item of snapshot.items) {
        const { versions: history, attachments: files, ...fields } = item;
        const itemId = randomUUID();
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
      await tx.backupRestore.create({ data: { userId, backupId, counts: { ...counts } } });
      return { alreadyRestored: false, counts };
    }, { timeout: 60000, maxWait: 10000 });
    await logAuditEvent({ userId, action: "vault.backup.restore", status: "success", metadata: { backupId, alreadyRestored: result.alreadyRestored } });
    res.json({ success: true, data: result });
  } catch (error) { next(error); }
});

export default router;
