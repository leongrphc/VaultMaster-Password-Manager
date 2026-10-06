import type { Request } from "express";
import { securityState } from "../middleware/reauthentication.js";
import type { Prisma } from '@prisma/client';
import { SECURITY_MESSAGES } from '@vaultmaster/shared';
import { prisma } from '../config/prisma.js';

export async function securityNotification(tx: Prisma.TransactionClient, userId: string, action: string) {
  if (!SECURITY_MESSAGES[action]) return;
  await tx.securityNotification.create({ data: { userId, action } });
}

// Persist the effect and its secret-free notification atomically. Audit metadata
// remains separate and is never included in the notification inbox.
export async function securityChange<T>(req: Request, action: string, operation: (tx: Prisma.TransactionClient) => Promise<T>) {
  const userId = req.user!.userId;
  return prisma.$transaction(async tx => {
    await assertReauthenticated(tx, req);
    const result = await operation(tx);
    await securityNotification(tx, userId, action);
    await tx.reauthentication.deleteMany({ where: { userId } });
    return result;
  });
}

export async function assertReauthenticated(tx: Prisma.TransactionClient, req: Request) {
  await tx.$queryRaw`SELECT id FROM users WHERE id = ${req.user!.userId} FOR UPDATE`;
  const user = await tx.user.findUnique({ where: { id: req.user!.userId }, include: { webAuthnCredentials: { select: { id: true } } } });
  const devices = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM devices WHERE id = ${req.user!.deviceId} AND "userId" = ${req.user!.userId}
      AND "refreshTokenHash" IS NOT NULL AND "refreshTokenReusedAt" IS NULL FOR UPDATE
  `;
  if (!user || devices.length !== 1 || !req.reauthenticationState || securityState(user, user.webAuthnCredentials) !== req.reauthenticationState) {
    throw Object.assign(new Error('Kimlik doğrulaması değişti. Yeniden doğrulayın.'), { status: 403, code: 'REAUTH_REQUIRED' });
  }
}
