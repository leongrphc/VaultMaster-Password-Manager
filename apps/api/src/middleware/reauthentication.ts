import { createHash } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { sensitiveAction } from '@vaultmaster/shared';
import { prisma } from '../config/prisma.js';
import { authMiddleware } from './auth.js';
import { durableLimit } from './durable-limit.js';

declare global { namespace Express { interface Request { reauthenticationState?: string } } }

export function securityState(user: { masterPasswordHash: string; twoFactorEnabled: boolean; twoFactorSecret: string | null }, credentials: { id: string }[]) {
  return createHash('sha256').update(JSON.stringify([user.masterPasswordHash, user.twoFactorEnabled, user.twoFactorSecret,
    credentials.map(c => c.id).sort()])).digest('hex');
}
export function proofHash(token: string) { return createHash('sha256').update(token).digest('hex'); }
export const sensitiveLimit = durableLimit('sensitive-account', 30, true);

export function sensitiveSecurityMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!sensitiveAction(req.method, req.path)) { next(); return; }
  authMiddleware(req, res, error => {
    if (error) { next(error); return; }
    sensitiveLimit(req, res, error => {
      if (error) { next(error); return; }
      void consumeProof(req, res, next);
    });
  }).catch(next);
}

async function consumeProof(req: Request, res: Response, next: NextFunction) {
  try {
    res.setHeader('Cache-Control', 'no-store');
    const token = req.headers['x-vaultmaster-reauth'];
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
      res.status(403).json({ success: false, error: 'Bu işlem için yeniden doğrulama gerekli.', code: 'REAUTH_REQUIRED' }); return;
    }
    let verifiedState: string | undefined;
    const accepted = await prisma.$transaction(async tx => {
      const user = await tx.user.findUnique({ where: { id: req.user!.userId }, include: { webAuthnCredentials: { select: { id: true } } } });
      if (!user) return false;
      verifiedState = securityState(user, user.webAuthnCredentials);
      const rows = await tx.$queryRaw<Array<{ tokenHash: string }>>`
        DELETE FROM reauthentications r USING devices d
        WHERE r."tokenHash" = ${proofHash(token)} AND r."userId" = ${user.id}
          AND r."deviceId" = ${req.user!.deviceId} AND r.target = ${`${req.method} ${req.path}`}
          AND r."stateHash" = ${securityState(user, user.webAuthnCredentials)} AND r."expiresAt" > CURRENT_TIMESTAMP
          AND d.id = r."deviceId" AND d."userId" = r."userId"
          AND d."refreshTokenHash" IS NOT NULL AND d."refreshTokenReusedAt" IS NULL
        RETURNING r."tokenHash"
      `;
      return rows.length === 1;
    });
    if (!accepted) {
      res.status(403).json({ success: false, error: 'Yeniden doğrulama geçersiz veya süresi dolmuş.', code: 'REAUTH_REQUIRED' }); return;
    }
    req.reauthenticationState = verifiedState;
    next();
  } catch (error) { next(error); }
}
