import { Router, type Request, type Response } from "express";
import { prisma } from "../config/prisma.js";
import { env } from "../config/env.js";
import { getRequestId } from "../utils/request-context.js";

const router: Router = Router();
const startedAt = Date.now();

function createBaseHealthPayload(req: Request, mode: "live" | "ready") {
  return {
    status: "ok" as const,
    service: "api",
    mode,
    environment: env.NODE_ENV,
    uptimeSeconds: Math.round(process.uptime()),
    process: {
      pid: process.pid,
      memoryRssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      startedAt: new Date(startedAt).toISOString(),
    },
    timestamp: new Date().toISOString(),
    requestId: getRequestId(req),
  };
}

router.get("/", async (req: Request, res: Response) => {
  res.json({
    ...createBaseHealthPayload(req, "live"),
  });
});

router.get("/ready", async (req: Request, res: Response) => {
  const dbCheckStartedAt = Date.now();

  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      ...createBaseHealthPayload(req, "ready"),
      checks: {
        database: {
          status: "ok",
          latencyMs: Date.now() - dbCheckStartedAt,
        },
      },
    });
  } catch {
    res.status(503).json({
      ...createBaseHealthPayload(req, "ready"),
      status: "error",
      checks: {
        database: {
          status: "error",
          latencyMs: Date.now() - dbCheckStartedAt,
        },
      },
    });
  }
});

export default router;
