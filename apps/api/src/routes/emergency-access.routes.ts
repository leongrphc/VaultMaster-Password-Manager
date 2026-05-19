import { Router, type Request, type Response } from "express";
import {
  emergencyAccessGrantSchema,
  vaultItemIdSchema,
} from "@vaultmaster/shared";
import { prisma } from "../config/prisma.js";
import { authMiddleware } from "../middleware/auth.js";
import { logAuditEvent } from "../utils/audit-log.js";
import { getRequestIp, getRequestUserAgent } from "../utils/request-context.js";

const router: Router = Router();

router.use(authMiddleware);

type EmergencyGrant = Awaited<ReturnType<typeof prisma.emergencyAccessGrant.findFirstOrThrow>>;

function serializeGrant(
  grant: EmergencyGrant & { owner?: { email: string }; contact?: { email: string } },
  options: { includeEncryptedAccessKey?: boolean } = {}
) {
  return {
    id: grant.id,
    ownerId: grant.ownerId,
    ownerEmail: grant.owner?.email,
    contactId: grant.contactId,
    contactEmail: grant.contact?.email,
    encryptedAccessKey: options.includeEncryptedAccessKey ? grant.encryptedAccessKey : undefined,
    encryptedAccessIv: options.includeEncryptedAccessKey ? grant.encryptedAccessIv : undefined,
    waitTimeDays: grant.waitTimeDays,
    status: grant.status,
    requestedAt: grant.requestedAt?.toISOString() ?? null,
    availableAt: grant.availableAt?.toISOString() ?? null,
    createdAt: grant.createdAt.toISOString(),
    updatedAt: grant.updatedAt.toISOString(),
  };
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

async function audit(req: Request, action: string, metadata: Record<string, unknown>) {
  await logAuditEvent({
    userId: req.user!.userId,
    action,
    status: "success",
    ipAddress: getRequestIp(req),
    userAgent: getRequestUserAgent(req),
    metadata,
  });
}

async function findGrantForUser(id: string, userId: string) {
  return prisma.emergencyAccessGrant.findFirst({
    where: {
      id,
      OR: [{ ownerId: userId }, { contactId: userId }],
    },
    include: {
      owner: { select: { email: true } },
      contact: { select: { email: true } },
    },
  });
}

router.get("/", async (req: Request, res: Response) => {
  const grants = await prisma.emergencyAccessGrant.findMany({
    where: {
      OR: [{ ownerId: req.user!.userId }, { contactId: req.user!.userId }],
    },
    include: {
      owner: { select: { email: true } },
      contact: { select: { email: true } },
    },
    orderBy: { updatedAt: "desc" },
  });

  res.json({
    success: true,
    data: grants.map((grant) => serializeGrant(grant)),
  });
});

router.post("/", async (req: Request, res: Response) => {
  const body = emergencyAccessGrantSchema.parse(req.body);
  const contact = await prisma.user.findUnique({
    where: { email: body.contactEmail.toLowerCase().trim() },
    select: { id: true, email: true },
  });

  if (!contact) {
    res.status(404).json({ success: false, error: "Acil durum kişisi bulunamadı" });
    return;
  }

  if (contact.id === req.user!.userId) {
    res.status(400).json({ success: false, error: "Kendinizi acil durum kişisi olarak ekleyemezsiniz" });
    return;
  }

  const existing = await prisma.emergencyAccessGrant.findUnique({
    where: { ownerId_contactId: { ownerId: req.user!.userId, contactId: contact.id } },
  });

  if (existing && existing.status !== "cancelled" && existing.status !== "rejected") {
    res.status(409).json({ success: false, error: "Bu kişi için acil durum erişimi zaten var" });
    return;
  }

  const grant = existing
    ? await prisma.emergencyAccessGrant.update({
        where: { id: existing.id },
        data: {
          encryptedAccessKey: body.encryptedAccessKey,
          encryptedAccessIv: body.encryptedAccessIv,
          waitTimeDays: body.waitTimeDays,
          status: "pending",
          requestedAt: null,
          availableAt: null,
        },
        include: { contact: { select: { email: true } } },
      })
    : await prisma.emergencyAccessGrant.create({
        data: {
          ownerId: req.user!.userId,
          contactId: contact.id,
          encryptedAccessKey: body.encryptedAccessKey,
          encryptedAccessIv: body.encryptedAccessIv,
          waitTimeDays: body.waitTimeDays,
          status: "pending",
        },
        include: { contact: { select: { email: true } } },
      });

  await audit(req, "emergency_access.invite", {
    grantId: grant.id,
    contactId: contact.id,
    waitTimeDays: grant.waitTimeDays,
  });

  res.status(201).json({ success: true, data: serializeGrant(grant) });
});

router.post("/:id/accept", async (req: Request, res: Response) => {
  const { id } = vaultItemIdSchema.parse({ id: req.params.id });
  const grant = await findGrantForUser(id, req.user!.userId);

  if (!grant) {
    res.status(404).json({ success: false, error: "Acil durum erişimi bulunamadı" });
    return;
  }

  if (grant.contactId !== req.user!.userId || grant.status !== "pending") {
    res.status(403).json({ success: false, error: "Bu daveti kabul etme yetkiniz yok" });
    return;
  }

  const updated = await prisma.emergencyAccessGrant.update({
    where: { id },
    data: { status: "active" },
    include: { owner: { select: { email: true } }, contact: { select: { email: true } } },
  });

  await audit(req, "emergency_access.invite.accept", { grantId: id, ownerId: grant.ownerId });
  res.json({ success: true, data: serializeGrant(updated) });
});

router.post("/:id/request", async (req: Request, res: Response) => {
  const { id } = vaultItemIdSchema.parse({ id: req.params.id });
  const grant = await findGrantForUser(id, req.user!.userId);

  if (!grant) {
    res.status(404).json({ success: false, error: "Acil durum erişimi bulunamadı" });
    return;
  }

  if (grant.contactId !== req.user!.userId || grant.status !== "active") {
    res.status(403).json({ success: false, error: "Bu erişimi talep etme yetkiniz yok" });
    return;
  }

  const requestedAt = new Date();
  const updated = await prisma.emergencyAccessGrant.update({
    where: { id },
    data: {
      status: "requested",
      requestedAt,
      availableAt: addDays(requestedAt, grant.waitTimeDays),
    },
    include: { owner: { select: { email: true } }, contact: { select: { email: true } } },
  });

  await audit(req, "emergency_access.request", { grantId: id, ownerId: grant.ownerId });
  res.json({ success: true, data: serializeGrant(updated) });
});

router.post("/:id/approve", async (req: Request, res: Response) => {
  const { id } = vaultItemIdSchema.parse({ id: req.params.id });
  const grant = await findGrantForUser(id, req.user!.userId);

  if (!grant) {
    res.status(404).json({ success: false, error: "Acil durum erişimi bulunamadı" });
    return;
  }

  if (grant.ownerId !== req.user!.userId || grant.status !== "requested") {
    res.status(403).json({ success: false, error: "Bu talebi onaylama yetkiniz yok" });
    return;
  }

  const updated = await prisma.emergencyAccessGrant.update({
    where: { id },
    data: { status: "approved", availableAt: new Date() },
    include: { owner: { select: { email: true } }, contact: { select: { email: true } } },
  });

  await audit(req, "emergency_access.request.approve", { grantId: id, contactId: grant.contactId });
  res.json({ success: true, data: serializeGrant(updated) });
});

router.post("/:id/reject", async (req: Request, res: Response) => {
  const { id } = vaultItemIdSchema.parse({ id: req.params.id });
  const grant = await findGrantForUser(id, req.user!.userId);

  if (!grant) {
    res.status(404).json({ success: false, error: "Acil durum erişimi bulunamadı" });
    return;
  }

  if (grant.contactId === req.user!.userId && grant.status === "pending") {
    const updated = await prisma.emergencyAccessGrant.update({
      where: { id },
      data: { status: "rejected" },
      include: { owner: { select: { email: true } }, contact: { select: { email: true } } },
    });
    await audit(req, "emergency_access.invite.reject", { grantId: id, ownerId: grant.ownerId });
    res.json({ success: true, data: serializeGrant(updated) });
    return;
  }

  if (grant.ownerId === req.user!.userId && grant.status === "requested") {
    const updated = await prisma.emergencyAccessGrant.update({
      where: { id },
      data: { status: "active", requestedAt: null, availableAt: null },
      include: { owner: { select: { email: true } }, contact: { select: { email: true } } },
    });
    await audit(req, "emergency_access.request.reject", { grantId: id, contactId: grant.contactId });
    res.json({ success: true, data: serializeGrant(updated) });
    return;
  }

  res.status(403).json({ success: false, error: "Bu işlemi yapma yetkiniz yok" });
});

router.post("/:id/cancel", async (req: Request, res: Response) => {
  const { id } = vaultItemIdSchema.parse({ id: req.params.id });
  const grant = await findGrantForUser(id, req.user!.userId);

  if (!grant) {
    res.status(404).json({ success: false, error: "Acil durum erişimi bulunamadı" });
    return;
  }

  if (grant.ownerId !== req.user!.userId) {
    res.status(403).json({ success: false, error: "Bu erişimi iptal etme yetkiniz yok" });
    return;
  }

  const updated = await prisma.emergencyAccessGrant.update({
    where: { id },
    data: { status: "cancelled", requestedAt: null, availableAt: null },
    include: { owner: { select: { email: true } }, contact: { select: { email: true } } },
  });

  await audit(req, "emergency_access.cancel", { grantId: id, contactId: grant.contactId });
  res.json({ success: true, data: serializeGrant(updated) });
});

router.get("/:id/release", async (req: Request, res: Response) => {
  const { id } = vaultItemIdSchema.parse({ id: req.params.id });
  const grant = await findGrantForUser(id, req.user!.userId);

  if (!grant) {
    res.status(404).json({ success: false, error: "Acil durum erişimi bulunamadı" });
    return;
  }

  if (grant.contactId !== req.user!.userId) {
    res.status(403).json({ success: false, error: "Şifreli erişim anahtarını alma yetkiniz yok" });
    return;
  }

  const availableAt = grant.availableAt?.getTime() ?? Number.POSITIVE_INFINITY;
  const canRelease = grant.status === "approved" || (grant.status === "requested" && availableAt <= Date.now());

  if (!canRelease) {
    res.status(403).json({ success: false, error: "Bekleme süresi tamamlanmadı veya erişim onaylanmadı" });
    return;
  }

  await audit(req, "emergency_access.release", { grantId: id, ownerId: grant.ownerId });
  res.json({ success: true, data: serializeGrant(grant, { includeEncryptedAccessKey: true }) });
});

export default router;
