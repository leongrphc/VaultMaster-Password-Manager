import { Router, type Request, type Response } from "express";
import {
  createVaultItemSchema,
  updateVaultItemSchema,
  vaultItemIdSchema,
} from "@vaultmaster/shared";
import { prisma } from "../config/prisma.js";
import { authMiddleware } from "../middleware/auth.js";
import { snapshotVaultItem } from "../utils/vault-history.js";
import { logAuditEvent } from "../utils/audit-log.js";
import { getRequestIp, getRequestUserAgent } from "../utils/request-context.js";

const router: Router = Router();

router.use(authMiddleware);

async function findOwnedVaultItem(id: string, userId: string) {
  return prisma.vaultItem.findFirst({
    where: { id, userId },
  });
}

// GET /api/vault
router.get("/", async (req: Request, res: Response) => {
  const items = await prisma.vaultItem.findMany({
    where: { userId: req.user!.userId, deletedAt: null },
    orderBy: { updatedAt: "desc" },
  });

  res.json({ success: true, data: items });
});

// GET /api/vault/trash
router.get("/trash", async (req: Request, res: Response) => {
  const items = await prisma.vaultItem.findMany({
    where: {
      userId: req.user!.userId,
      deletedAt: { not: null },
    },
    orderBy: { deletedAt: "desc" },
  });

  res.json({ success: true, data: items });
});

// GET /api/vault/:id/history
router.get("/:id/history", async (req: Request, res: Response) => {
  const { id } = vaultItemIdSchema.parse({ id: req.params.id });

  const item = await findOwnedVaultItem(id, req.user!.userId);
  if (!item) {
    res.status(404).json({ success: false, error: "Öğe bulunamadı" });
    return;
  }

  const versions = await prisma.vaultItemVersion.findMany({
    where: { vaultItemId: item.id },
    orderBy: { createdAt: "desc" },
  });

  res.json({
    success: true,
    data: versions.map((version) => ({
      ...version,
      createdAt: version.createdAt.toISOString(),
    })),
  });
});

// POST /api/vault/:id/restore
router.post("/:id/restore", async (req: Request, res: Response) => {
  const { id } = vaultItemIdSchema.parse({ id: req.params.id });

  const item = await findOwnedVaultItem(id, req.user!.userId);
  if (!item) {
    res.status(404).json({ success: false, error: "Öğe bulunamadı" });
    return;
  }

  if (!item.deletedAt) {
    res.status(400).json({ success: false, error: "Öğe zaten aktif" });
    return;
  }

  await snapshotVaultItem(item, "restore_before");

  const restored = await prisma.vaultItem.update({
    where: { id: item.id },
    data: {
      deletedAt: null,
    },
  });

  await logAuditEvent({
    userId: req.user!.userId,
    action: "vault.item.restore",
    status: "success",
    ipAddress: getRequestIp(req),
    userAgent: getRequestUserAgent(req),
    metadata: { itemId: item.id },
  });

  res.json({ success: true, data: restored });
});

// POST /api/vault/:id/history/:versionId/restore
router.post("/:id/history/:versionId/restore", async (req: Request, res: Response) => {
  const { id } = vaultItemIdSchema.parse({ id: req.params.id });
  const { id: versionId } = vaultItemIdSchema.parse({ id: req.params.versionId });

  const item = await findOwnedVaultItem(id, req.user!.userId);
  if (!item) {
    res.status(404).json({ success: false, error: "Öğe bulunamadı" });
    return;
  }

  const version = await prisma.vaultItemVersion.findFirst({
    where: {
      id: versionId,
      vaultItemId: item.id,
    },
  });

  if (!version) {
    res.status(404).json({ success: false, error: "Geçmiş sürüm bulunamadı" });
    return;
  }

  await snapshotVaultItem(item, "history_restore_before");

  const restored = await prisma.vaultItem.update({
    where: { id: item.id },
    data: {
      encryptedData: version.encryptedData,
      iv: version.iv,
      folderId: version.folderId,
      favorite: version.favorite,
      deletedAt: null,
    },
  });

  await logAuditEvent({
    userId: req.user!.userId,
    action: "vault.item.history.restore",
    status: "success",
    ipAddress: getRequestIp(req),
    userAgent: getRequestUserAgent(req),
    metadata: { itemId: item.id, versionId: version.id },
  });

  res.json({ success: true, data: restored });
});

// DELETE /api/vault/:id/purge
router.delete("/:id/purge", async (req: Request, res: Response) => {
  const { id } = vaultItemIdSchema.parse({ id: req.params.id });

  const item = await findOwnedVaultItem(id, req.user!.userId);
  if (!item) {
    res.status(404).json({ success: false, error: "Öğe bulunamadı" });
    return;
  }

  if (!item.deletedAt) {
    res.status(400).json({ success: false, error: "Sadece çöp kutusundaki öğeler kalıcı silinebilir" });
    return;
  }

  await prisma.vaultItem.delete({ where: { id: item.id } });

  await logAuditEvent({
    userId: req.user!.userId,
    action: "vault.item.purge",
    status: "success",
    ipAddress: getRequestIp(req),
    userAgent: getRequestUserAgent(req),
    metadata: { itemId: item.id },
  });

  res.json({ success: true, data: { message: "Öğe kalıcı olarak silindi" } });
});

// GET /api/vault/:id
router.get("/:id", async (req: Request, res: Response) => {
  const { id } = vaultItemIdSchema.parse({ id: req.params.id });
  const item = await findOwnedVaultItem(id, req.user!.userId);

  if (!item) {
    res.status(404).json({ success: false, error: "Öğe bulunamadı" });
    return;
  }

  res.json({ success: true, data: item });
});

// POST /api/vault
router.post("/", async (req: Request, res: Response) => {
  const body = createVaultItemSchema.parse(req.body);

  const item = await prisma.vaultItem.create({
    data: {
      userId: req.user!.userId,
      encryptedData: body.encryptedData,
      iv: body.iv,
      folderId: body.folderId ?? null,
      favorite: body.favorite,
    },
  });

  await logAuditEvent({
    userId: req.user!.userId,
    action: "vault.item.create",
    status: "success",
    ipAddress: getRequestIp(req),
    userAgent: getRequestUserAgent(req),
    metadata: { itemId: item.id },
  });

  res.status(201).json({ success: true, data: item });
});

// PUT /api/vault/:id
router.put("/:id", async (req: Request, res: Response) => {
  const body = updateVaultItemSchema.parse(req.body);
  const { id } = vaultItemIdSchema.parse({ id: req.params.id });

  const existing = await findOwnedVaultItem(id, req.user!.userId);
  if (!existing) {
    res.status(404).json({ success: false, error: "Öğe bulunamadı" });
    return;
  }

  await snapshotVaultItem(existing, "update");

  const updated = await prisma.vaultItem.update({
    where: { id },
    data: {
      ...body,
      deletedAt: null,
    },
  });

  await logAuditEvent({
    userId: req.user!.userId,
    action: "vault.item.update",
    status: "success",
    ipAddress: getRequestIp(req),
    userAgent: getRequestUserAgent(req),
    metadata: { itemId: existing.id },
  });

  res.json({ success: true, data: updated });
});

// DELETE /api/vault/:id
router.delete("/:id", async (req: Request, res: Response) => {
  const { id } = vaultItemIdSchema.parse({ id: req.params.id });

  const existing = await findOwnedVaultItem(id, req.user!.userId);
  if (!existing) {
    res.status(404).json({ success: false, error: "Öğe bulunamadı" });
    return;
  }

  if (existing.deletedAt) {
    res.status(400).json({ success: false, error: "Öğe zaten çöp kutusunda" });
    return;
  }

  await snapshotVaultItem(existing, "delete");

  await prisma.vaultItem.update({
    where: { id },
    data: { deletedAt: new Date() },
  });

  await logAuditEvent({
    userId: req.user!.userId,
    action: "vault.item.delete",
    status: "success",
    ipAddress: getRequestIp(req),
    userAgent: getRequestUserAgent(req),
    metadata: { itemId: existing.id },
  });

  res.json({ success: true, data: { message: "Öğe çöp kutusuna taşındı" } });
});

export default router;
