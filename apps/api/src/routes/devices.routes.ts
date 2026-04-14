import { Router, type Request, type Response } from "express";
import {
  deviceIdSchema,
  revokeOtherDevicesSchema,
  updateDeviceSchema,
} from "@vaultmaster/shared";
import { prisma } from "../config/prisma.js";
import { authMiddleware } from "../middleware/auth.js";
import { logAuditEvent } from "../utils/audit-log.js";
import { getRequestIp, getRequestUserAgent } from "../utils/request-context.js";

const router: Router = Router();

router.use(authMiddleware);

router.get("/", async (req: Request, res: Response) => {
  const devices = await prisma.device.findMany({
    where: { userId: req.user!.userId },
    orderBy: [{ lastActive: "desc" }, { createdAt: "desc" }],
  });

  res.json({
    success: true,
    data: devices.map((device) => ({
      id: device.id,
      userId: device.userId,
      deviceName: device.deviceName,
      deviceType: device.deviceType,
      createdAt: device.createdAt.toISOString(),
      lastActive: device.lastActive.toISOString(),
    })),
  });
});

router.patch("/:id", async (req: Request, res: Response) => {
  const { id } = deviceIdSchema.parse({ id: req.params.id });
  const { deviceName } = updateDeviceSchema.parse(req.body);

  const device = await prisma.device.findFirst({
    where: { id, userId: req.user!.userId },
  });

  if (!device) {
    res.status(404).json({ success: false, error: "Oturum bulunamadı" });
    return;
  }

  const updatedDevice = await prisma.device.update({
    where: { id: device.id },
    data: { deviceName },
  });

  await logAuditEvent({
    userId: req.user!.userId,
    deviceId: updatedDevice.id,
    action: "security.session.rename",
    status: "success",
    ipAddress: getRequestIp(req),
    userAgent: getRequestUserAgent(req),
    metadata: {
      previousDeviceName: device.deviceName,
      nextDeviceName: updatedDevice.deviceName,
    },
  });

  res.json({
    success: true,
    data: {
      id: updatedDevice.id,
      userId: updatedDevice.userId,
      deviceName: updatedDevice.deviceName,
      deviceType: updatedDevice.deviceType,
      createdAt: updatedDevice.createdAt.toISOString(),
      lastActive: updatedDevice.lastActive.toISOString(),
    },
  });
});

router.post("/revoke-others", async (req: Request, res: Response) => {
  const { currentDeviceId } = revokeOtherDevicesSchema.parse(req.body);

  const currentDevice = await prisma.device.findFirst({
    where: {
      id: currentDeviceId,
      userId: req.user!.userId,
    },
  });

  if (!currentDevice) {
    res.status(404).json({ success: false, error: "Mevcut oturum bulunamadı" });
    return;
  }

  const devicesToRevoke = await prisma.device.findMany({
    where: {
      userId: req.user!.userId,
      id: { not: currentDeviceId },
    },
    select: {
      id: true,
      deviceName: true,
      deviceType: true,
    },
  });

  await prisma.device.deleteMany({
    where: {
      userId: req.user!.userId,
      id: { not: currentDeviceId },
    },
  });

  await logAuditEvent({
    userId: req.user!.userId,
    deviceId: currentDeviceId,
    action: "security.session.revoke_others",
    status: "success",
    ipAddress: getRequestIp(req),
    userAgent: getRequestUserAgent(req),
    metadata: {
      revokedCount: devicesToRevoke.length,
      revokedDevices: devicesToRevoke,
    },
  });

  res.json({
    success: true,
    data: {
      revokedCount: devicesToRevoke.length,
    },
  });
});

router.delete("/:id", async (req: Request, res: Response) => {
  const { id } = deviceIdSchema.parse({ id: req.params.id });

  const device = await prisma.device.findFirst({
    where: { id, userId: req.user!.userId },
  });

  if (!device) {
    res.status(404).json({ success: false, error: "Oturum bulunamadı" });
    return;
  }

  await prisma.device.delete({
    where: { id: device.id },
  });

  await logAuditEvent({
    userId: req.user!.userId,
    action: "security.session.revoke",
    status: "success",
    ipAddress: getRequestIp(req),
    userAgent: getRequestUserAgent(req),
    metadata: {
      revokedDeviceId: device.id,
      revokedDeviceName: device.deviceName,
      revokedDeviceType: device.deviceType,
    },
  });

  res.json({
    success: true,
    data: { message: "Oturum sonlandırıldı" },
  });
});

export default router;
