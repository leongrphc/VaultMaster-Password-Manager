import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import argon2 from 'argon2';
import * as OTPAuth from 'otpauth';
import { z } from 'zod';
import { sensitiveAction, SECURITY_MESSAGES } from '@vaultmaster/shared';
import { prisma } from '../config/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { durableLimit } from '../middleware/durable-limit.js';
import { proofHash, securityState } from '../middleware/reauthentication.js';
import { readStoredSecret } from '../utils/secret-crypto.js';
import { consumeRecoveryCode } from '../utils/recovery-codes.js';
import { createWebAuthnLoginOptions, verifyWebAuthnLogin } from './webauthn.routes.js';
import { securityNotification } from '../utils/security-notifications.js';
import { logAuditEvent } from '../utils/audit-log.js';

const router: Router = Router();
const proofSchema = z.object({
  method: z.enum(['POST', 'GET', 'PATCH', 'DELETE']), path: z.string().min(1).max(300),
  authHash: z.string().min(1).max(1024), code: z.string().regex(/^\d{6}$/).optional(),
  recoveryCode: z.string().max(100).optional(), webAuthnResponse: z.unknown().optional(), webAuthnChallengeToken: z.string().max(100).optional(),
}).strict();
router.post('/reauthenticate', authMiddleware, durableLimit('reauth-ip', 50), durableLimit('reauth-account', 10, true), async (req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    const body = proofSchema.parse(req.body);
    if (!sensitiveAction(body.method, body.path)) { res.status(400).json({ success: false, error: 'Geçersiz işlem.' }); return; }
    const user = await prisma.user.findUnique({ where: { id: req.user!.userId }, include: { webAuthnCredentials: { select: { id: true } } } });
    const fail = () => res.status(403).json({ success: false, error: 'Kimlik doğrulaması başarısız.' });
    if (!user || !await argon2.verify(user.masterPasswordHash, body.authHash)) { fail(); return; }
    const requiresFactor = user.twoFactorEnabled || user.webAuthnCredentials.length > 0;
    if (requiresFactor && !body.code && !body.recoveryCode && !body.webAuthnResponse) {
      res.json({ success: true, data: { requires2FA: true,
        ...(user.webAuthnCredentials.length ? { webAuthnOptions: await createWebAuthnLoginOptions(user.id, `reauth:${req.user!.deviceId}:${body.method} ${body.path}`) } : {}) } }); return;
    }
    let remaining: string[] | null = null;
    let factor = !requiresFactor;
    if (user.twoFactorEnabled && body.recoveryCode) {
      remaining = await consumeRecoveryCode(Array.isArray(user.twoFactorRecoveryCodes) ? user.twoFactorRecoveryCodes as string[] : [], body.recoveryCode);
      factor = remaining !== null;
    }
    if (user.twoFactorEnabled && user.twoFactorSecret && body.code) {
      const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(readStoredSecret(user.twoFactorSecret)), algorithm: 'SHA1', digits: 6, period: 30 });
      factor ||= totp.validate({ token: body.code, window: 1 }) !== null;
    }
    if (body.webAuthnResponse && user.webAuthnCredentials.length) factor ||= await verifyWebAuthnLogin(user.id, body.webAuthnResponse, body.webAuthnChallengeToken, `reauth:${req.user!.deviceId}:${body.method} ${body.path}`).catch(() => false);
    if (!factor) { fail(); return; }
    const token = randomBytes(32).toString('base64url');
    const created = await prisma.$transaction(async tx => {
      // Serialize recovery-code consumption and compare the verified security state.
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${user.id} FOR UPDATE`;
      const current = await tx.user.findUnique({ where: { id: user.id }, include: { webAuthnCredentials: { select: { id: true } } } });
      if (!current || securityState(current, current.webAuthnCredentials) !== securityState(user, user.webAuthnCredentials)) return false;
      await tx.$queryRaw`SELECT id FROM devices WHERE id = ${req.user!.deviceId} AND "userId" = ${user.id} FOR UPDATE`;
      const device = await tx.device.findFirst({ where: { id: req.user!.deviceId, userId: user.id, refreshTokenHash: { not: null }, refreshTokenReusedAt: null } });
      if (!device) return false;
      if (remaining) {
        if (JSON.stringify(current.twoFactorRecoveryCodes) !== JSON.stringify(user.twoFactorRecoveryCodes)) return false;
        await tx.user.update({ where: { id: user.id }, data: { twoFactorRecoveryCodes: remaining } });
      }
      await tx.reauthentication.deleteMany({ where: { userId: user.id, expiresAt: { lte: new Date() } } });
      await tx.reauthentication.create({ data: { tokenHash: proofHash(token), userId: user.id, deviceId: device.id,
        stateHash: securityState(current, current.webAuthnCredentials), target: `${body.method} ${body.path}`, expiresAt: new Date(Date.now() + 300000) } });
      return true;
    });
    if (!created) { fail(); return; }
    res.json({ success: true, data: { proof: token, expiresIn: 300 } });
  } catch (error) { next(error); }
});
router.post('/export-authorize', authMiddleware, async (req, res, next) => {
  try { await securityNotification(prisma, req.user!.userId, 'vault.export'); await logAuditEvent({ userId: req.user!.userId, action: 'vault.export', status: 'success' }); res.json({ success: true }); }
  catch (error) { next(error); }
});
router.get('/security-notifications', authMiddleware, async (req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    const rows = await prisma.securityNotification.findMany({ where: { userId: req.user!.userId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 50 });
    res.json({ success: true, data: rows.map(row => ({ id: row.id, action: row.action, message: SECURITY_MESSAGES[row.action], createdAt: row.createdAt, readAt: row.readAt })) });
  } catch (error) { next(error); }
});
router.post('/security-notifications/:id/read', authMiddleware, async (req, res, next) => {
  try {
    await prisma.securityNotification.updateMany({ where: { id: String(req.params.id), userId: req.user!.userId, readAt: null }, data: { readAt: new Date() } });
    res.json({ success: true });
  } catch (error) { next(error); }
});
export default router;
