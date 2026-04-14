import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { logError } from "./logger.js";

interface AuditLogInput {
  userId: string;
  action: string;
  status: "success" | "failure" | "info";
  deviceId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown> | null;
}

export async function logAuditEvent(input: AuditLogInput): Promise<void> {
  try {
    await prisma.auditEvent.create({
      data: {
        userId: input.userId,
        action: input.action,
        status: input.status,
        deviceId: input.deviceId ?? null,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        metadata: input.metadata
          ? (input.metadata as Prisma.InputJsonValue)
          : undefined,
      },
    });
  } catch (error) {
    logError("audit_log_write_failed", error, {
      userId: input.userId,
      action: input.action,
      status: input.status,
    });
  }
}
