import { randomUUID } from "node:crypto";
import { Router, type Request, type Response, type NextFunction } from "express";
import argon2 from "argon2";
import * as OTPAuth from "otpauth";
import {
  registerSchema,
  loginSchema,
  refreshTokenSchema,
  passwordChangeSchema,
  accountDeleteSchema,
} from "@vaultmaster/shared";
import { prisma } from "../config/prisma.js";
import {
  generateAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  verifyRefreshToken,
} from "../utils/jwt.js";
import { authMiddleware } from "../middleware/auth.js";
import { readStoredSecret } from "../utils/secret-crypto.js";
import { logAuditEvent } from "../utils/audit-log.js";
import {
  getRequestIp,
  getRequestUserAgent,
  inferDeviceType,
} from "../utils/request-context.js";
import {
  consumeRecoveryCode,
  createRecoveryCodes,
} from "../utils/recovery-codes.js";
import {
  createWebAuthnLoginOptions,
  verifyWebAuthnLogin,
} from "./webauthn.routes.js";

import { isWebClient, setWebSession, clearWebSession, REFRESH_COOKIE } from "../utils/web-session.js";

const router: Router = Router();

function vaultKeyEnvelope(user: { wrappedVaultKey: string | null; wrappedVaultKeyIv: string | null; vaultKeyVersion: number }) {
  return user.vaultKeyVersion === 0 ? null : {
    ciphertext: user.wrappedVaultKey!, iv: user.wrappedVaultKeyIv!, version: user.vaultKeyVersion,
  };
}

const passwordHashOptions =
  process.env.NODE_ENV === "test"
    ? { type: argon2.argon2id, memoryCost: 4096, timeCost: 2, parallelism: 1 }
    : { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 4 };

function readRecoveryCodeHashes(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

// POST /api/auth/register
router.post("/register", async (req: Request, res: Response) => {
  try {
    const body = registerSchema.parse(req.body);
    const normalizedEmail = body.email.toLowerCase().trim();
    const userAgent = getRequestUserAgent(req);
    const ipAddress = getRequestIp(req);

    const existing = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (existing) {
      res.status(409).json({ success: false, error: "Bu e-posta adresi zaten kayıtlı" });
      return;
    }

    // Client'tan gelen authHash'i Argon2 ile hash'le
    const serverHash = await argon2.hash(body.authHash, passwordHashOptions);

    const user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        masterPasswordHash: serverHash,
        kdfSalt: body.kdfSalt,
        kdfIterations: body.kdfIterations,
        wrappedVaultKey: body.vaultKeyEnvelope?.ciphertext,
        wrappedVaultKeyIv: body.vaultKeyEnvelope?.iv,
        vaultKeyVersion: body.vaultKeyEnvelope ? 1 : 0,
      },
    });

    const deviceId = randomUUID();
    const tokenPayload = { userId: user.id, email: user.email, deviceId };
    const accessToken = generateAccessToken(tokenPayload);
    const refreshToken = generateRefreshToken(tokenPayload);

    const device = await prisma.device.create({
      data: {
        id: deviceId,
        userId: user.id,
        deviceName: userAgent?.slice(0, 100) ?? "Unknown",
        deviceType: inferDeviceType(userAgent),
        refreshTokenHash: hashRefreshToken(refreshToken),
      },
    });

    await logAuditEvent({
      userId: user.id,
      deviceId: device.id,
      action: "auth.register",
      status: "success",
      ipAddress,
      userAgent,
    });

    if (isWebClient(req)) setWebSession(res, accessToken, refreshToken);
    res.status(201).json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          createdAt: user.createdAt.toISOString(),
        },
        ...(isWebClient(req) ? { session: true } : { tokens: { accessToken, refreshToken } }),
        deviceId: device.id,
        kdfSalt: user.kdfSalt,
        kdfIterations: user.kdfIterations,
        vaultKeyEnvelope: vaultKeyEnvelope(user),
      },
    });
  } catch (error) {
    if (error instanceof Error && error.name === "ZodError") {
      res.status(400).json({ success: false, error: "Geçersiz veri formatı" });
      return;
    }
    throw error;
  }
});

// POST /api/auth/login
router.post("/login", async (req: Request, res: Response) => {
  try {
    const body = loginSchema.parse(req.body);
    const normalizedEmail = body.email.toLowerCase().trim();
    const userAgent = getRequestUserAgent(req);
    const ipAddress = getRequestIp(req);

    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user) {
      res.status(401).json({ success: false, error: "E-posta veya şifre hatalı" });
      return;
    }

    const valid = await argon2.verify(user.masterPasswordHash, body.authHash);

    if (!valid) {
      await logAuditEvent({
        userId: user.id,
        action: "auth.login",
        status: "failure",
        ipAddress,
        userAgent,
        metadata: { reason: "invalid_auth_hash" },
      });
      res.status(401).json({ success: false, error: "E-posta veya şifre hatalı" });
      return;
    }

    if (user.vaultKeyVersion > 0 && body.vaultKeyProtocol !== 1) {
      res.status(409).json({ success: false, error: "Kasa anahtarını açmak için uygulamayı güncelleyin." });
      return;
    }

    const webAuthnCredentials = await prisma.webAuthnCredential.findMany({
      where: { userId: user.id },
      select: { id: true },
    });
    const requiresWebAuthn = webAuthnCredentials.length > 0;

    if (user.twoFactorEnabled || requiresWebAuthn) {
      const recoveryCodeHashes = readRecoveryCodeHashes(user.twoFactorRecoveryCodes);

      if (!body.code && !body.recoveryCode && !body.webAuthnResponse) {
        const webAuthnChallenge = requiresWebAuthn
          ? await createWebAuthnLoginOptions(user.id)
          : undefined;
        res.status(200).json({
          success: true,
          data: {
            requires2FA: true,
            webAuthnOptions: webAuthnChallenge,
          },
        });
        return;
      }

      let recoveryCodesAfterUse: string[] | null = null;
      let totpVerified = false;
      let webAuthnVerified = false;

      if (body.recoveryCode && user.twoFactorEnabled) {
        recoveryCodesAfterUse = await consumeRecoveryCode(
          recoveryCodeHashes,
          body.recoveryCode
        );
      }

      if (body.code && user.twoFactorEnabled) {
        if (!user.twoFactorSecret) {
          res.status(500).json({ success: false, error: "2FA yapılandırma hatası" });
          return;
        }

        const totp = new OTPAuth.TOTP({
          issuer: "VaultMaster",
          label: user.email,
          algorithm: "SHA1",
          digits: 6,
          period: 30,
          secret: OTPAuth.Secret.fromBase32(readStoredSecret(user.twoFactorSecret)),
        });

        totpVerified = totp.validate({ token: body.code, window: 1 }) !== null;
      }

      if (body.webAuthnResponse && requiresWebAuthn) {
        webAuthnVerified = await verifyWebAuthnLogin(
          user.id,
          body.webAuthnResponse,
          (req.body as { webAuthnChallengeToken?: unknown }).webAuthnChallengeToken
        ).catch(() => false);
      }

      if (!totpVerified && recoveryCodesAfterUse === null && !webAuthnVerified) {
        await logAuditEvent({
          userId: user.id,
          action: requiresWebAuthn && body.webAuthnResponse ? "auth.login.webauthn" : "auth.login.2fa",
          status: "failure",
          ipAddress,
          userAgent,
          metadata: {
            reason: body.recoveryCode
              ? "invalid_recovery_code"
              : body.webAuthnResponse
              ? "invalid_webauthn_response"
              : "invalid_2fa_code",
          },
        });
        res.status(401).json({ success: false, error: "Geçersiz veya süresi dolmuş 2FA doğrulaması" });
        return;
      }

      if (recoveryCodesAfterUse) {
        await prisma.user.update({
          where: { id: user.id },
          data: {
            twoFactorRecoveryCodes: recoveryCodesAfterUse,
          },
        });
      }
    }

    const deviceId = randomUUID();
    const tokenPayload = { userId: user.id, email: user.email, deviceId };
    const accessToken = generateAccessToken(tokenPayload);
    const refreshToken = generateRefreshToken(tokenPayload);

    const device = await prisma.$transaction(async (tx) => {
      // Serialize session creation with password changes. A login that verified
      // an old hash must not create a new session after other devices are revoked.
      const matching = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM users WHERE id = ${user.id}
          AND "masterPasswordHash" = ${user.masterPasswordHash}
          AND "vaultKeyVersion" = ${user.vaultKeyVersion} FOR UPDATE
      `;
      if (matching.length !== 1) return null;
      return tx.device.create({ data: {
        id: deviceId, userId: user.id, deviceName: userAgent?.slice(0, 100) ?? "Unknown",
        deviceType: inferDeviceType(userAgent), refreshTokenHash: hashRefreshToken(refreshToken),
      } });
    });
    if (!device) {
      res.status(401).json({ success: false, error: "Kimlik doğrulama bilgileri değişti. Yeniden giriş yapın." });
      return;
    }

    await logAuditEvent({
      userId: user.id,
      deviceId: device.id,
      action: user.twoFactorEnabled || webAuthnCredentials.length > 0 ? "auth.login.2fa" : "auth.login",
      status: "success",
      ipAddress,
      userAgent,
    });

    if (isWebClient(req)) setWebSession(res, accessToken, refreshToken);
    res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          createdAt: user.createdAt.toISOString(),
        },
        ...(isWebClient(req) ? { session: true } : { tokens: { accessToken, refreshToken } }),
        deviceId: device.id,
        kdfSalt: user.kdfSalt,
        kdfIterations: user.kdfIterations,
        vaultKeyEnvelope: vaultKeyEnvelope(user),
      },
    });
  } catch (error) {
    if (error instanceof Error && error.name === "ZodError") {
      res.status(400).json({ success: false, error: "Geçersiz veri formatı" });
      return;
    }
    throw error;
  }
});

// Password changes rewrap the stable data key, never rewrite vault ciphertext.
router.get("/vault-key", authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
    if (!user) { res.status(401).json({ success: false, error: "Oturum geçersiz" }); return; }
    res.json({ success: true, data: { vaultKeyEnvelope: vaultKeyEnvelope(user) } });
  } catch (error) { next(error); }
});

router.post("/change-password", authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = passwordChangeSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
    if (!user || !await argon2.verify(user.masterPasswordHash, body.currentAuthHash)) {
      res.status(401).json({ success: false, error: "Mevcut ana şifre doğrulanamadı" });
      return;
    }
    const nextServerHash = await argon2.hash(body.newAuthHash, passwordHashOptions);
    const changed = await prisma.$transaction(async (tx) => {
      // CAS also checks the verified hash: two simultaneous changes cannot both
      // succeed or overwrite each other's envelope. A revoked caller cannot win.
      const device = await tx.device.findFirst({ where: {
        id: req.user!.deviceId, userId: user.id, refreshTokenHash: { not: null }, refreshTokenReusedAt: null,
      } });
      if (!device) return false;
      const updated = await tx.user.updateMany({
        where: { id: user.id, vaultKeyVersion: body.expectedVaultKeyVersion, masterPasswordHash: user.masterPasswordHash },
        data: {
          masterPasswordHash: nextServerHash, kdfIterations: body.kdfIterations,
          wrappedVaultKey: body.vaultKeyEnvelope.ciphertext, wrappedVaultKeyIv: body.vaultKeyEnvelope.iv,
          vaultKeyVersion: { increment: 1 },
        },
      });
      if (updated.count !== 1) return false;
      await tx.device.deleteMany({ where: { userId: user.id, id: { not: req.user!.deviceId } } });
      return true;
    });
    if (!changed) {
      res.status(409).json({ success: false, error: "Kasa anahtarı veya oturum değişti. Yeniden giriş yapın." });
      return;
    }
    await logAuditEvent({ userId: user.id, action: "security.password.change", status: "success",
      ipAddress: getRequestIp(req), userAgent: getRequestUserAgent(req) });
    res.json({ success: true, data: { message: "Ana şifre güncellendi", vaultKeyEnvelope: {
      ...body.vaultKeyEnvelope, version: body.expectedVaultKeyVersion + 1,
    } } });
  } catch (error) { next(error); }
});

// POST /api/auth/delete-account
router.post("/delete-account", authMiddleware, async (req: Request, res: Response) => {
  const body = accountDeleteSchema.parse(req.body);
  const user = await prisma.user.findUnique({
    where: { id: req.user!.userId },
  });

  if (!user) {
    res.status(404).json({ success: false, error: "Kullanıcı bulunamadı" });
    return;
  }

  const valid = await argon2.verify(user.masterPasswordHash, body.authHash);
  if (!valid) {
    res.status(401).json({ success: false, error: "Ana şifre doğrulanamadı" });
    return;
  }

  if (user.twoFactorEnabled) {
    if (!user.twoFactorSecret) {
      res.status(500).json({ success: false, error: "2FA yapılandırma hatası" });
      return;
    }

    const recoveryCodeHashes = readRecoveryCodeHashes(user.twoFactorRecoveryCodes);
    const recoveryCodesAfterUse = body.recoveryCode
      ? await consumeRecoveryCode(recoveryCodeHashes, body.recoveryCode)
      : null;

    const totp = new OTPAuth.TOTP({
      issuer: "VaultMaster",
      label: user.email,
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(readStoredSecret(user.twoFactorSecret)),
    });

    const delta = body.code ? totp.validate({ token: body.code, window: 1 }) : null;
    if (delta === null && recoveryCodesAfterUse === null) {
      res.status(401).json({ success: false, error: "2FA doğrulaması başarısız" });
      return;
    }

    if (recoveryCodesAfterUse) {
      await prisma.user.update({
        where: { id: user.id },
        data: { twoFactorRecoveryCodes: recoveryCodesAfterUse },
      });
    }
  }

  await logAuditEvent({
    userId: user.id,
    action: "security.account.delete",
    status: "success",
    ipAddress: getRequestIp(req),
    userAgent: getRequestUserAgent(req),
  });

  await prisma.user.delete({
    where: { id: user.id },
  });

  if (isWebClient(req)) clearWebSession(res);
  res.json({
    success: true,
    data: { message: "Hesap kalıcı olarak silindi" },
  });
});

// POST /api/auth/refresh
router.post("/refresh", async (req: Request, res: Response) => {
  try {
    const { refreshToken } = refreshTokenSchema.parse(isWebClient(req) ? { refreshToken: req.cookies?.[REFRESH_COOKIE] } : req.body);

    const payload = verifyRefreshToken(refreshToken);
    const refreshTokenHash = hashRefreshToken(refreshToken);

    const device = await prisma.device.findUnique({
      where: { refreshTokenHash },
    });

    if (!device || device.userId !== payload.userId || device.id !== payload.deviceId) {
      const reusedDevice = await prisma.device.findFirst({
        where: {
          userId: payload.userId,
          id: payload.deviceId,
          previousRefreshTokenHash: refreshTokenHash,
        },
      });

      if (reusedDevice) {
        await prisma.device.update({
          where: { id: reusedDevice.id },
          data: {
            refreshTokenHash: null,
            previousRefreshTokenHash: null,
            refreshTokenReusedAt: new Date(),
          },
        });

        await logAuditEvent({
          userId: payload.userId,
          deviceId: reusedDevice.id,
          action: "auth.refresh.reuse_detected",
          status: "failure",
          ipAddress: getRequestIp(req),
          userAgent: getRequestUserAgent(req),
          metadata: { reason: "previous_refresh_token_reused" },
        });
      }

      res.status(401).json({ success: false, error: "Geçersiz refresh token" });
      return;
    }

    const newAccessToken = generateAccessToken({
      userId: payload.userId,
      email: payload.email,
      deviceId: device.id,
    });
    const newRefreshToken = generateRefreshToken({
      userId: payload.userId,
      email: payload.email,
      deviceId: device.id,
    });
    const newRefreshTokenHash = hashRefreshToken(newRefreshToken);

    const rotated = await prisma.device.updateMany({
      where: { id: device.id, refreshTokenHash },
      data: {
        previousRefreshTokenHash: refreshTokenHash,
        refreshTokenHash: newRefreshTokenHash,
        lastActive: new Date(),
      },
    });

    if (rotated.count !== 1) {
      res.status(401).json({ success: false, error: "Geçersiz refresh token" });
      return;
    }

    await logAuditEvent({
      userId: payload.userId,
      deviceId: device.id,
      action: "auth.refresh",
      status: "success",
      ipAddress: getRequestIp(req),
      userAgent: getRequestUserAgent(req),
    });

    if (isWebClient(req)) setWebSession(res, newAccessToken, newRefreshToken);
    res.json({
      success: true,
      data: {
        ...(isWebClient(req) ? { session: true } : { tokens: { accessToken: newAccessToken, refreshToken: newRefreshToken } }),
        deviceId: device.id,
      },
    });
  } catch {
    res.status(401).json({ success: false, error: "Geçersiz veya süresi dolmuş token" });
  }
});

// POST /api/auth/logout
router.post("/logout", async (req: Request, res: Response, next: NextFunction) => {
  if (!isWebClient(req)) { next(); return; }
  try {
    let payload;
    try { payload = verifyRefreshToken(req.cookies?.[REFRESH_COOKIE]); }
    catch { /* Missing, expired or invalid cookies still need clearing. */ }
    if (payload) {
      await prisma.device.deleteMany({ where: { id: payload.deviceId, userId: payload.userId } });
      await logAuditEvent({ userId: payload.userId, deviceId: payload.deviceId, action: "auth.logout", status: "success",
        ipAddress: getRequestIp(req), userAgent: getRequestUserAgent(req) });
    }
    clearWebSession(res);
    res.json({ success: true, data: { message: "Çıkış yapıldı" } });
  } catch (error) { next(error); }
}, authMiddleware, async (req: Request, res: Response) => {
  await logAuditEvent({
    userId: req.user!.userId, deviceId: req.user!.deviceId, action: "auth.logout", status: "success",
    ipAddress: getRequestIp(req), userAgent: getRequestUserAgent(req),
  });
  await prisma.device.deleteMany({ where: { id: req.user!.deviceId, userId: req.user!.userId } });
  if (isWebClient(req)) clearWebSession(res);
  res.json({ success: true, data: { message: "Çıkış yapıldı" } });
});

// GET /api/auth/me
router.get("/me", authMiddleware, async (req: Request, res: Response) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.userId },
    select: { id: true, email: true, createdAt: true },
  });

  if (!user) {
    res.status(404).json({ success: false, error: "Kullanıcı bulunamadı" });
    return;
  }

  res.json({
    success: true,
    data: { user: { ...user, createdAt: user.createdAt.toISOString() } },
  });
});

export default router;
