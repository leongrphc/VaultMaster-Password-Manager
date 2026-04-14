import { Router, type Request, type Response } from "express";
import { Prisma } from "@prisma/client";
import * as OTPAuth from "otpauth";
import QRCode from "qrcode";
import { twoFactorCodeSchema } from "@vaultmaster/shared";
import { prisma } from "../config/prisma.js";
import { authMiddleware } from "../middleware/auth.js";
import {
  encryptSensitiveValue,
  readStoredSecret,
} from "../utils/secret-crypto.js";
import {
  consumeRecoveryCode,
  createRecoveryCodes,
} from "../utils/recovery-codes.js";
import { logAuditEvent } from "../utils/audit-log.js";
import {
  getRequestIp,
  getRequestUserAgent,
} from "../utils/request-context.js";

const router: Router = Router();
router.use(authMiddleware);

function readRecoveryCodeHashes(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

// POST /api/auth/2fa/setup — QR kodu ve secret üretir
router.post("/setup", async (req: Request, res: Response) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.userId },
  });

  if (!user) {
    res.status(404).json({ success: false, error: "Kullanıcı bulunamadı" });
    return;
  }

  if (user.twoFactorEnabled) {
    res.status(400).json({ success: false, error: "2FA zaten aktif" });
    return;
  }

  const secret = new OTPAuth.Secret({ size: 20 });

  const totp = new OTPAuth.TOTP({
    issuer: "VaultMaster",
    label: user.email,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret,
  });

  // Secret'ı veritabanına kaydet (henüz aktifleştirme)
  await prisma.user.update({
    where: { id: user.id },
    data: { twoFactorSecret: encryptSensitiveValue(secret.base32) },
  });

  await logAuditEvent({
    userId: user.id,
    action: "security.2fa.setup",
    status: "info",
    ipAddress: getRequestIp(req),
    userAgent: getRequestUserAgent(req),
  });

  const otpauthUrl = totp.toString();
  const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl, {
    width: 256,
    margin: 2,
    color: { dark: "#e8ecf4", light: "#0a0e1a" },
  });

  res.json({
    success: true,
    data: {
      secret: secret.base32,
      qrCode: qrCodeDataUrl,
      otpauthUrl,
    },
  });
});

// POST /api/auth/2fa/verify — Kodu doğrulayıp 2FA'yı aktifleştir
router.post("/verify", async (req: Request, res: Response) => {
  const { code } = twoFactorCodeSchema.parse(req.body);

  if (!code) {
    res.status(400).json({ success: false, error: "6 haneli doğrulama kodu gerekli" });
    return;
  }

  const user = await prisma.user.findUnique({
    where: { id: req.user!.userId },
  });

  if (!user || !user.twoFactorSecret) {
    res.status(400).json({ success: false, error: "Önce 2FA kurulumu yapın" });
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

  const delta = totp.validate({ token: code, window: 1 });

  if (delta === null) {
    res.status(400).json({ success: false, error: "Geçersiz doğrulama kodu" });
    return;
  }

  const { plaintextCodes, hashedCodes } = await createRecoveryCodes();

  await prisma.user.update({
    where: { id: user.id },
    data: {
      twoFactorEnabled: true,
      twoFactorRecoveryCodes: hashedCodes,
    },
  });

  await logAuditEvent({
    userId: user.id,
    action: "security.2fa.enable",
    status: "success",
    ipAddress: getRequestIp(req),
    userAgent: getRequestUserAgent(req),
  });

  res.json({
    success: true,
    data: {
      message: "2FA başarıyla aktifleştirildi",
      recoveryCodes: plaintextCodes,
    },
  });
});

// POST /api/auth/2fa/disable — 2FA'yı devre dışı bırak
router.post("/disable", async (req: Request, res: Response) => {
  const { code, recoveryCode } = twoFactorCodeSchema.parse(req.body);

  if (!code && !recoveryCode) {
    res.status(400).json({ success: false, error: "Doğrulama kodu veya recovery code gerekli" });
    return;
  }

  const user = await prisma.user.findUnique({
    where: { id: req.user!.userId },
  });

  if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) {
    res.status(400).json({ success: false, error: "2FA aktif değil" });
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

  const recoveryCodeHashes = readRecoveryCodeHashes(user.twoFactorRecoveryCodes);
  const recoveryCodesAfterUse = recoveryCode
    ? await consumeRecoveryCode(recoveryCodeHashes, recoveryCode)
    : null;
  const delta = code ? totp.validate({ token: code, window: 1 }) : null;

  if (delta === null && recoveryCodesAfterUse === null) {
    res.status(400).json({ success: false, error: "Geçersiz doğrulama kodu" });
    return;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      twoFactorEnabled: false,
      twoFactorSecret: null,
      twoFactorRecoveryCodes: Prisma.JsonNull,
    },
  });

  await logAuditEvent({
    userId: user.id,
    action: "security.2fa.disable",
    status: "success",
    ipAddress: getRequestIp(req),
    userAgent: getRequestUserAgent(req),
  });

  res.json({
    success: true,
    data: { message: "2FA devre dışı bırakıldı" },
  });
});

router.post("/recovery-codes/regenerate", async (req: Request, res: Response) => {
  const { code, recoveryCode } = twoFactorCodeSchema.parse(req.body);

  if (!code && !recoveryCode) {
    res.status(400).json({ success: false, error: "Doğrulama kodu veya recovery code gerekli" });
    return;
  }

  const user = await prisma.user.findUnique({
    where: { id: req.user!.userId },
  });

  if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) {
    res.status(400).json({ success: false, error: "2FA aktif değil" });
    return;
  }

  const recoveryCodeHashes = readRecoveryCodeHashes(user.twoFactorRecoveryCodes);
  const recoveryCodesAfterUse = recoveryCode
    ? await consumeRecoveryCode(recoveryCodeHashes, recoveryCode)
    : null;

  const totp = new OTPAuth.TOTP({
    issuer: "VaultMaster",
    label: user.email,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(readStoredSecret(user.twoFactorSecret)),
  });

  const delta = code ? totp.validate({ token: code, window: 1 }) : null;
  if (delta === null && recoveryCodesAfterUse === null) {
    res.status(400).json({ success: false, error: "Geçersiz doğrulama kodu" });
    return;
  }

  const { plaintextCodes, hashedCodes } = await createRecoveryCodes();

  await prisma.user.update({
    where: { id: user.id },
    data: {
      twoFactorRecoveryCodes: hashedCodes,
    },
  });

  await logAuditEvent({
    userId: user.id,
    action: "security.2fa.recovery_codes.regenerate",
    status: "success",
    ipAddress: getRequestIp(req),
    userAgent: getRequestUserAgent(req),
  });

  res.json({
    success: true,
    data: {
      recoveryCodes: plaintextCodes,
    },
  });
});

// GET /api/auth/2fa/status — 2FA durumunu sorgula
router.get("/status", async (req: Request, res: Response) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.userId },
    select: { twoFactorEnabled: true, twoFactorRecoveryCodes: true },
  });

  res.json({
    success: true,
    data: {
      enabled: user?.twoFactorEnabled ?? false,
      recoveryCodesRemaining: readRecoveryCodeHashes(user?.twoFactorRecoveryCodes).length,
    },
  });
});

export default router;
