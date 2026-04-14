import { Router, type Request, type Response } from "express";
import { prisma } from "../config/prisma.js";
import { authMiddleware } from "../middleware/auth.js";

const router: Router = Router();

router.use(authMiddleware);

router.get("/", async (req: Request, res: Response) => {
  const requestedLimit = Number.parseInt(String(req.query.limit ?? "20"), 10);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 1), 100)
    : 20;

  const events = await prisma.auditEvent.findMany({
    where: { userId: req.user!.userId },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      device: {
        select: {
          id: true,
          deviceName: true,
          deviceType: true,
        },
      },
    },
  });

  res.json({
    success: true,
    data: events.map((event) => ({
      id: event.id,
      userId: event.userId,
      deviceId: event.deviceId,
      deviceName: event.device?.deviceName ?? null,
      deviceType: event.device?.deviceType ?? null,
      action: event.action,
      status: event.status,
      ipAddress: event.ipAddress,
      userAgent: event.userAgent,
      metadata:
        event.metadata && typeof event.metadata === "object"
          ? (event.metadata as Record<string, unknown>)
          : null,
      createdAt: event.createdAt.toISOString(),
    })),
  });
});

export default router;
