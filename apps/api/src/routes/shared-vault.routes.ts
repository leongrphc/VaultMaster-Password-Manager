import { Router, type Request, type Response } from "express";
import {
  sharedVaultCreateSchema,
  sharedVaultInviteSchema,
  sharedVaultItemCreateSchema,
  sharedVaultItemUpdateSchema,
  vaultItemIdSchema,
} from "@vaultmaster/shared";
import { prisma } from "../config/prisma.js";
import { authMiddleware } from "../middleware/auth.js";
import { logAuditEvent } from "../utils/audit-log.js";
import { getRequestIp, getRequestUserAgent } from "../utils/request-context.js";

const router: Router = Router();

router.use(authMiddleware);

function serializeDate<T extends { createdAt: Date; updatedAt: Date }>(record: T) {
  return {
    ...record,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

async function findSharedVaultAccess(sharedVaultId: string, userId: string) {
  const sharedVault = await prisma.sharedVault.findUnique({
    where: { id: sharedVaultId },
    include: {
      members: {
        where: { userId },
        take: 1,
      },
    },
  });

  if (!sharedVault) {
    return null;
  }

  const membership = sharedVault.members[0] ?? null;
  const isOwner = sharedVault.ownerId === userId;

  if (!isOwner && !membership) {
    return null;
  }

  return { sharedVault, membership, isOwner };
}

function canManageMembers(access: NonNullable<Awaited<ReturnType<typeof findSharedVaultAccess>>>) {
  return access.isOwner || access.membership?.role === "admin";
}

function canWriteItems(access: NonNullable<Awaited<ReturnType<typeof findSharedVaultAccess>>>) {
  return access.isOwner || ["owner", "admin", "editor"].includes(access.membership?.role ?? "");
}

function serializeSharedVaultItem<T extends { createdAt: Date; updatedAt: Date; deletedAt: Date | null }>(item: T) {
  return {
    ...item,
    deletedAt: item.deletedAt?.toISOString() ?? null,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

function canRemoveMember(
  access: NonNullable<Awaited<ReturnType<typeof findSharedVaultAccess>>>,
  target: { userId: string; role: string }
) {
  if (target.userId === access.sharedVault.ownerId) {
    return false;
  }

  if (target.userId === access.membership?.userId) {
    return true;
  }

  if (access.isOwner) {
    return true;
  }

  return access.membership?.role === "admin" && target.role !== "admin";
}

// GET /api/shared-vaults
router.get("/", async (req: Request, res: Response) => {
  const sharedVaults = await prisma.sharedVault.findMany({
    where: {
      OR: [
        { ownerId: req.user!.userId },
        { members: { some: { userId: req.user!.userId } } },
      ],
    },
    include: {
      members: {
        where: { userId: req.user!.userId },
        take: 1,
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  res.json({
    success: true,
    data: sharedVaults.map((sharedVault) => {
      const membership = sharedVault.members[0] ?? null;
      return {
        id: sharedVault.id,
        ownerId: sharedVault.ownerId,
        encryptedMetadata: sharedVault.encryptedMetadata,
        metadataIv: sharedVault.metadataIv,
        currentUserMembership: membership ? serializeDate(membership) : null,
        createdAt: sharedVault.createdAt.toISOString(),
        updatedAt: sharedVault.updatedAt.toISOString(),
      };
    }),
  });
});

// POST /api/shared-vaults
router.post("/", async (req: Request, res: Response) => {
  const body = sharedVaultCreateSchema.parse(req.body);

  const sharedVault = await prisma.$transaction(async (tx) => {
    const created = await tx.sharedVault.create({
      data: {
        ownerId: req.user!.userId,
        encryptedMetadata: body.encryptedMetadata,
        metadataIv: body.metadataIv,
      },
    });

    await tx.sharedVaultMember.create({
      data: {
        sharedVaultId: created.id,
        userId: req.user!.userId,
        role: "owner",
        status: "active",
        encryptedVaultKey: body.encryptedVaultKey,
        encryptedVaultKeyIv: body.encryptedVaultKeyIv,
      },
    });

    return created;
  });

  await logAuditEvent({
    userId: req.user!.userId,
    action: "shared_vault.create",
    status: "success",
    ipAddress: getRequestIp(req),
    userAgent: getRequestUserAgent(req),
    metadata: { sharedVaultId: sharedVault.id },
  });

  res.status(201).json({
    success: true,
    data: {
      id: sharedVault.id,
      ownerId: sharedVault.ownerId,
      encryptedMetadata: sharedVault.encryptedMetadata,
      metadataIv: sharedVault.metadataIv,
      createdAt: sharedVault.createdAt.toISOString(),
      updatedAt: sharedVault.updatedAt.toISOString(),
    },
  });
});

// GET /api/shared-vaults/:id/items
router.get("/:id/items", async (req: Request, res: Response) => {
  const { id } = vaultItemIdSchema.parse({ id: req.params.id });
  const access = await findSharedVaultAccess(id, req.user!.userId);

  if (!access) {
    res.status(404).json({ success: false, error: "Paylaşımlı kasa bulunamadı" });
    return;
  }

  const items = await prisma.sharedVaultItem.findMany({
    where: { sharedVaultId: id, deletedAt: null },
    orderBy: { updatedAt: "desc" },
  });

  res.json({ success: true, data: items.map(serializeSharedVaultItem) });
});

// POST /api/shared-vaults/:id/items
router.post("/:id/items", async (req: Request, res: Response) => {
  const { id } = vaultItemIdSchema.parse({ id: req.params.id });
  const body = sharedVaultItemCreateSchema.parse(req.body);
  const access = await findSharedVaultAccess(id, req.user!.userId);

  if (!access) {
    res.status(404).json({ success: false, error: "Paylaşımlı kasa bulunamadı" });
    return;
  }

  if (!canWriteItems(access)) {
    res.status(403).json({ success: false, error: "Paylaşımlı kasa öğesi oluşturma yetkiniz yok" });
    return;
  }

  const item = await prisma.sharedVaultItem.create({
    data: {
      sharedVaultId: id,
      createdById: req.user!.userId,
      encryptedData: body.encryptedData,
      iv: body.iv,
      favorite: body.favorite,
    },
  });

  await logAuditEvent({
    userId: req.user!.userId,
    action: "shared_vault.item.create",
    status: "success",
    ipAddress: getRequestIp(req),
    userAgent: getRequestUserAgent(req),
    metadata: { sharedVaultId: id, itemId: item.id },
  });

  res.status(201).json({ success: true, data: serializeSharedVaultItem(item) });
});

// PUT /api/shared-vaults/:id/items/:itemId
router.put("/:id/items/:itemId", async (req: Request, res: Response) => {
  const { id } = vaultItemIdSchema.parse({ id: req.params.id });
  const { id: itemId } = vaultItemIdSchema.parse({ id: req.params.itemId });
  const body = sharedVaultItemUpdateSchema.parse(req.body);
  const access = await findSharedVaultAccess(id, req.user!.userId);

  if (!access) {
    res.status(404).json({ success: false, error: "Paylaşımlı kasa bulunamadı" });
    return;
  }

  if (!canWriteItems(access)) {
    res.status(403).json({ success: false, error: "Paylaşımlı kasa öğesi güncelleme yetkiniz yok" });
    return;
  }

  const existing = await prisma.sharedVaultItem.findFirst({
    where: { id: itemId, sharedVaultId: id, deletedAt: null },
  });

  if (!existing) {
    res.status(404).json({ success: false, error: "Paylaşımlı kasa öğesi bulunamadı" });
    return;
  }

  const item = await prisma.sharedVaultItem.update({
    where: { id: itemId },
    data: { ...body, deletedAt: null },
  });

  await logAuditEvent({
    userId: req.user!.userId,
    action: "shared_vault.item.update",
    status: "success",
    ipAddress: getRequestIp(req),
    userAgent: getRequestUserAgent(req),
    metadata: { sharedVaultId: id, itemId: item.id },
  });

  res.json({ success: true, data: serializeSharedVaultItem(item) });
});

// DELETE /api/shared-vaults/:id/items/:itemId
router.delete("/:id/items/:itemId", async (req: Request, res: Response) => {
  const { id } = vaultItemIdSchema.parse({ id: req.params.id });
  const { id: itemId } = vaultItemIdSchema.parse({ id: req.params.itemId });
  const access = await findSharedVaultAccess(id, req.user!.userId);

  if (!access) {
    res.status(404).json({ success: false, error: "Paylaşımlı kasa bulunamadı" });
    return;
  }

  if (!canWriteItems(access)) {
    res.status(403).json({ success: false, error: "Paylaşımlı kasa öğesi silme yetkiniz yok" });
    return;
  }

  const existing = await prisma.sharedVaultItem.findFirst({
    where: { id: itemId, sharedVaultId: id, deletedAt: null },
  });

  if (!existing) {
    res.status(404).json({ success: false, error: "Paylaşımlı kasa öğesi bulunamadı" });
    return;
  }

  await prisma.sharedVaultItem.update({
    where: { id: itemId },
    data: { deletedAt: new Date() },
  });

  await logAuditEvent({
    userId: req.user!.userId,
    action: "shared_vault.item.delete",
    status: "success",
    ipAddress: getRequestIp(req),
    userAgent: getRequestUserAgent(req),
    metadata: { sharedVaultId: id, itemId },
  });

  res.json({ success: true, data: { message: "Paylaşımlı kasa öğesi silindi" } });
});

// GET /api/shared-vaults/:id/members
router.get("/:id/members", async (req: Request, res: Response) => {
  const { id } = vaultItemIdSchema.parse({ id: req.params.id });
  const access = await findSharedVaultAccess(id, req.user!.userId);

  if (!access) {
    res.status(404).json({ success: false, error: "Paylaşımlı kasa bulunamadı" });
    return;
  }

  const members = await prisma.sharedVaultMember.findMany({
    where: { sharedVaultId: id },
    include: { user: { select: { email: true } } },
    orderBy: { createdAt: "asc" },
  });

  res.json({
    success: true,
    data: members.map((member) => ({
      ...serializeDate(member),
      email: member.user.email,
      user: undefined,
    })),
  });
});

// POST /api/shared-vaults/:id/invite
router.post("/:id/invite", async (req: Request, res: Response) => {
  const { id } = vaultItemIdSchema.parse({ id: req.params.id });
  const body = sharedVaultInviteSchema.parse(req.body);
  const access = await findSharedVaultAccess(id, req.user!.userId);

  if (!access) {
    res.status(404).json({ success: false, error: "Paylaşımlı kasa bulunamadı" });
    return;
  }

  if (!canManageMembers(access)) {
    res.status(403).json({ success: false, error: "Üye davet etme yetkiniz yok" });
    return;
  }

  const user = await prisma.user.findUnique({
    where: { email: body.email.toLowerCase().trim() },
    select: { id: true, email: true },
  });

  if (!user) {
    res.status(404).json({ success: false, error: "Davet edilecek kullanıcı bulunamadı" });
    return;
  }

  if (user.id === access.sharedVault.ownerId) {
    res.status(400).json({ success: false, error: "Kasa sahibi davet edilemez" });
    return;
  }

  const existing = await prisma.sharedVaultMember.findUnique({
    where: { sharedVaultId_userId: { sharedVaultId: id, userId: user.id } },
  });

  if (existing) {
    res.status(409).json({ success: false, error: "Kullanıcı zaten davet edilmiş" });
    return;
  }

  const member = await prisma.sharedVaultMember.create({
    data: {
      sharedVaultId: id,
      userId: user.id,
      role: body.role,
      status: "pending",
      encryptedVaultKey: body.encryptedVaultKey,
      encryptedVaultKeyIv: body.encryptedVaultKeyIv,
    },
  });

  await logAuditEvent({
    userId: req.user!.userId,
    action: "shared_vault.member.invite",
    status: "success",
    ipAddress: getRequestIp(req),
    userAgent: getRequestUserAgent(req),
    metadata: { sharedVaultId: id, memberId: member.id, invitedUserId: user.id, role: member.role },
  });

  res.status(201).json({
    success: true,
    data: {
      ...serializeDate(member),
      email: user.email,
    },
  });
});

// DELETE /api/shared-vaults/:id/members/:memberId
router.delete("/:id/members/:memberId", async (req: Request, res: Response) => {
  const { id } = vaultItemIdSchema.parse({ id: req.params.id });
  const { id: memberId } = vaultItemIdSchema.parse({ id: req.params.memberId });
  const access = await findSharedVaultAccess(id, req.user!.userId);

  if (!access) {
    res.status(404).json({ success: false, error: "Paylaşımlı kasa bulunamadı" });
    return;
  }

  const member = await prisma.sharedVaultMember.findFirst({
    where: { id: memberId, sharedVaultId: id },
  });

  if (!member) {
    res.status(404).json({ success: false, error: "Üye bulunamadı" });
    return;
  }

  if (!canRemoveMember(access, member)) {
    res.status(403).json({ success: false, error: "Üyeyi kaldırma yetkiniz yok" });
    return;
  }

  await prisma.sharedVaultMember.delete({ where: { id: member.id } });

  await logAuditEvent({
    userId: req.user!.userId,
    action: "shared_vault.member.remove",
    status: "success",
    ipAddress: getRequestIp(req),
    userAgent: getRequestUserAgent(req),
    metadata: { sharedVaultId: id, memberId: member.id, removedUserId: member.userId },
  });

  res.json({ success: true, data: { message: "Üye kaldırıldı" } });
});

export default router;
