import { Router, type Request, type Response } from "express";
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

const router: Router = Router();

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
      },
    });

    const tokenPayload = { userId: user.id, email: user.email };
    const accessToken = generateAccessToken(tokenPayload);
    const refreshToken = generateRefreshToken(tokenPayload);

    const device = await prisma.device.create({
      data: {
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

    res.status(201).json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          createdAt: user.createdAt.toISOString(),
        },
        tokens: { accessToken, refreshToken },
        deviceId: device.id,
        kdfSalt: user.kdfSalt,
        kdfIterations: user.kdfIterations,
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

    if (user.twoFactorEnabled) {
      const recoveryCodeHashes = readRecoveryCodeHashes(user.twoFactorRecoveryCodes);

      if (!body.code && !body.recoveryCode) {
        res.status(200).json({ success: true, data: { requires2FA: true } });
        return;
      }

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

      let recoveryCodesAfterUse: string[] | null = null;

      if (body.recoveryCode) {
        recoveryCodesAfterUse = await consumeRecoveryCode(
          recoveryCodeHashes,
          body.recoveryCode
        );
      }

      const delta = body.code
        ? totp.validate({ token: body.code, window: 1 })
        : null;

      if (delta === null && recoveryCodesAfterUse === null) {
        await logAuditEvent({
          userId: user.id,
          action: "auth.login.2fa",
          status: "failure",
          ipAddress,
          userAgent,
          metadata: { reason: body.recoveryCode ? "invalid_recovery_code" : "invalid_2fa_code" },
        });
        res.status(401).json({ success: false, error: "Geçersiz veya süresi dolmuş 2FA kodu" });
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

    const tokenPayload = { userId: user.id, email: user.email };
    const accessToken = generateAccessToken(tokenPayload);
    const refreshToken = generateRefreshToken(tokenPayload);

    const device = await prisma.device.create({
      data: {
        userId: user.id,
        deviceName: userAgent?.slice(0, 100) ?? "Unknown",
        deviceType: inferDeviceType(userAgent),
        refreshTokenHash: hashRefreshToken(refreshToken),
      },
    });

    await logAuditEvent({
      userId: user.id,
      deviceId: device.id,
      action: user.twoFactorEnabled ? "auth.login.2fa" : "auth.login",
      status: "success",
      ipAddress,
      userAgent,
    });

    res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          createdAt: user.createdAt.toISOString(),
        },
        tokens: { accessToken, refreshToken },
        deviceId: device.id,
        kdfSalt: user.kdfSalt,
        kdfIterations: user.kdfIterations,
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

// POST /api/auth/change-password
router.post("/change-password", authMiddleware, async (req: Request, res: Response) => {
  const body = passwordChangeSchema.parse(req.body);
  const user = await prisma.user.findUnique({
    where: { id: req.user!.userId },
  });

  if (!user) {
    res.status(404).json({ success: false, error: "Kullanıcı bulunamadı" });
    return;
  }

  const valid = await argon2.verify(user.masterPasswordHash, body.currentAuthHash);
  if (!valid) {
    res.status(401).json({ success: false, error: "Mevcut ana şifre doğrulanamadı" });
    return;
  }

  const requestedIds = new Set(body.items.map((item) => item.id));
  const currentItems = await prisma.vaultItem.findMany({
    where: {
      userId: user.id,
      deletedAt: null,
    },
  });

  if (currentItems.length !== body.items.length) {
    res.status(400).json({ success: false, error: "Tüm aktif kasa öğeleri yeniden şifrelenmeli" });
    return;
  }

  for (const item of currentItems) {
    if (!requestedIds.has(item.id)) {
      res.status(400).json({ success: false, error: "Eksik yeniden şifreleme verisi" });
      return;
    }
  }

  const nextServerHash = await argon2.hash(body.newAuthHash, passwordHashOptions);

  await prisma.$transaction(async (tx) => {
    for (const currentItem of currentItems) {
      await tx.vaultItemVersion.create({
        data: {
          vaultItemId: currentItem.id,
          encryptedData: currentItem.encryptedData,
          iv: currentItem.iv,
          folderId: currentItem.folderId,
          favorite: currentItem.favorite,
          reason: "password_change",
        },
      });
    }

    for (const item of body.items) {
      await tx.vaultItem.update({
        where: { id: item.id },
        data: {
          encryptedData: item.encryptedData,
          iv: item.iv,
        },
      });
    }

    await tx.user.update({
      where: { id: user.id },
      data: {
        masterPasswordHash: nextServerHash,
        kdfIterations: body.kdfIterations,
      },
    });
  });

  await logAuditEvent({
    userId: user.id,
    action: "security.password.change",
    status: "success",
    ipAddress: getRequestIp(req),
    userAgent: getRequestUserAgent(req),
  });

  res.json({
    success: true,
    data: { message: "Ana şifre güncellendi" },
  });
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

  res.json({
    success: true,
    data: { message: "Hesap kalıcı olarak silindi" },
  });
});

// POST /api/auth/refresh
router.post("/refresh", async (req: Request, res: Response) => {
  try {
    const { refreshToken } = refreshTokenSchema.parse(req.body);

    const payload = verifyRefreshToken(refreshToken);
    const refreshTokenHash = hashRefreshToken(refreshToken);

    const device = await prisma.device.findUnique({
      where: { refreshTokenHash },
    });

    if (!device || device.userId !== payload.userId) {
      const reusedDevice = await prisma.device.findFirst({
        where: {
          userId: payload.userId,
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
    });
    const newRefreshToken = generateRefreshToken({
      userId: payload.userId,
      email: payload.email,
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

    res.json({
      success: true,
      data: {
        tokens: {
          accessToken: newAccessToken,
          refreshToken: newRefreshToken,
        },
        deviceId: device.id,
      },
    });
  } catch {
    res.status(401).json({ success: false, error: "Geçersiz veya süresi dolmuş token" });
  }
});

// POST /api/auth/logout
router.post("/logout", authMiddleware, async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  if (authHeader) {
    // Refresh token'ı da body'den al
    const { refreshToken } = req.body as { refreshToken?: string };
    if (refreshToken) {
      const refreshTokenHash = hashRefreshToken(refreshToken);
      const devices = await prisma.device.findMany({
        where: { refreshTokenHash, userId: req.user!.userId },
        select: { id: true },
      });

      await prisma.device.deleteMany({
        where: { refreshTokenHash, userId: req.user!.userId },
      });

      for (const device of devices) {
        await logAuditEvent({
          userId: req.user!.userId,
          deviceId: device.id,
          action: "auth.logout",
          status: "success",
          ipAddress: getRequestIp(req),
          userAgent: getRequestUserAgent(req),
        });
      }
    }
  }

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
