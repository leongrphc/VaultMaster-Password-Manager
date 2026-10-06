import { asyncRoute } from "../utils/async-route.js";
import { securityChange, assertReauthenticated } from "../utils/security-notifications.js";
import { Router, type Request, type Response } from "express";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
  type AuthenticationResponseJSON,
} from "@simplewebauthn/server";
import { webAuthnCredentialNameSchema } from "@vaultmaster/shared";
import { prisma } from "../config/prisma.js";
import { authMiddleware } from "../middleware/auth.js";
import { logAuditEvent } from "../utils/audit-log.js";
import { getRequestIp, getRequestUserAgent } from "../utils/request-context.js";
import {
  createAuthenticationChallengeToken,
  createRegistrationChallengeToken,
  consumeAuthenticationChallengeToken,
  consumeRegistrationChallengeToken,
} from "../utils/webauthn-challenges.js";
import {
  credentialToResponse,
  getWebAuthnOrigin,
  getWebAuthnLoginOrigins,
  getWebAuthnRpId,
  parseTransports,
  rpName,
} from "../utils/webauthn.js";

const router: Router = Router();
router.use(authMiddleware);

router.get("/credentials", asyncRoute(async (req: Request, res: Response) => {
  const credentials = await prisma.webAuthnCredential.findMany({
    where: { userId: req.user!.userId },
    orderBy: { createdAt: "desc" },
  });

  res.json({
    success: true,
    data: credentials.map(credentialToResponse),
  });
}));

router.post("/registration/options", asyncRoute(async (req: Request, res: Response) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.userId },
    include: { webAuthnCredentials: true },
  });

  if (!user) {
    res.status(404).json({ success: false, error: "Kullanıcı bulunamadı" });
    return;
  }

  const options = await generateRegistrationOptions({
    rpName,
    rpID: getWebAuthnRpId(),
    userID: Buffer.from(user.id),
    userName: user.email,
    userDisplayName: user.email,
    timeout: 60_000,
    attestationType: "none",
    excludeCredentials: user.webAuthnCredentials.map((credential) => ({
      id: credential.credentialId,
      transports: parseTransports(credential.transports) as AuthenticatorTransportFuture[] | undefined,
    })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
  });

  res.json({
    success: true,
    data: {
      options,
      challengeToken: createRegistrationChallengeToken(`${user.id}:${req.user!.deviceId}`, options.challenge),
    },
  });
}));

router.post("/registration/verify", asyncRoute(async (req: Request, res: Response) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
  if (!user) {
    res.status(404).json({ success: false, error: "Kullanıcı bulunamadı" });
    return;
  }

  const { name } = webAuthnCredentialNameSchema.parse(req.body);
  const expectedChallenge = consumeRegistrationChallengeToken(req.body?.challengeToken, `${user.id}:${req.user!.deviceId}`);
  if (!expectedChallenge) {
    res.status(400).json({ success: false, error: "WebAuthn challenge süresi doldu" });
    return;
  }

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: req.body?.response as RegistrationResponseJSON,
      expectedChallenge,
      expectedOrigin: getWebAuthnOrigin(),
      expectedRPID: getWebAuthnRpId(),
      requireUserVerification: false,
    });
  } catch {
    await logAuditEvent({
      userId: user.id,
      action: "security.webauthn.register",
      status: "failure",
      ipAddress: getRequestIp(req),
      userAgent: getRequestUserAgent(req),
      metadata: { reason: "verification_failed" },
    });
    res.status(400).json({ success: false, error: "WebAuthn kaydı doğrulanamadı" });
    return;
  }

  if (!verification.verified) {
    res.status(400).json({ success: false, error: "WebAuthn kaydı doğrulanamadı" });
    return;
  }

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

  let created;
  try {
    created = await securityChange(req, "security.webauthn.register", tx => tx.webAuthnCredential.create({
      data: {
        userId: user.id,
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey).toString("base64url"),
        counter: credential.counter,
        deviceType: credentialDeviceType,
        backedUp: credentialBackedUp,
        transports: req.body?.response?.response?.transports ?? credential.transports ?? [],
        name: name ?? "Security key",
      },
    }));

  } catch (error) {
    if ((error as { code?: string }).code !== 'P2002') throw error;
    res.status(400).json({ success: false, error: "WebAuthn kaydı doğrulanamadı" }); return;
  }
  await logAuditEvent({
    userId: user.id,
    action: "security.webauthn.register",
    status: "success",
    ipAddress: getRequestIp(req),
    userAgent: getRequestUserAgent(req),
  });

  res.status(201).json({
    success: true,
    data: credentialToResponse(created),
  });
}));

router.patch("/credentials/:id", asyncRoute(async (req: Request, res: Response) => {
  const credentialId = req.params.id as string;
  const { name } = webAuthnCredentialNameSchema.parse(req.body);
  if (!name) {
    res.status(400).json({ success: false, error: "Kimlik doğrulayıcı adı gerekli" });
    return;
  }

  if (!credentialId) {
    res.status(400).json({ success: false, error: "Kimlik doğrulayıcı ID gerekli" });
    return;
  }

  const credential = await prisma.$transaction(async tx => {
    await assertReauthenticated(tx, req);
    const owned = await tx.webAuthnCredential.findFirst({ where: { id: credentialId, userId: req.user!.userId } });
    if (!owned) return null;
    const changed = await tx.webAuthnCredential.update({ where: { id: owned.id }, data: { name } });
    await tx.securityNotification.create({ data: { userId: req.user!.userId, action: "security.webauthn.rename" } });
    await tx.reauthentication.deleteMany({ where: { userId: req.user!.userId } });
    return changed;
  });
  if (!credential) { res.status(404).json({ success: false, error: "WebAuthn kimlik doğrulayıcı bulunamadı" }); return; }
  await logAuditEvent({ userId: req.user!.userId, action: "security.webauthn.rename", status: "success" });

  res.json({ success: true, data: credential ? credentialToResponse(credential) : null });
}));

router.delete("/credentials/:id", asyncRoute(async (req: Request, res: Response) => {
  const credentialId = req.params.id as string;
  if (!credentialId) {
    res.status(400).json({ success: false, error: "Kimlik doğrulayıcı ID gerekli" });
    return;
  }

  const credential = await prisma.webAuthnCredential.findFirst({
    where: { id: credentialId, userId: req.user!.userId },
  });

  if (!credential) {
    res.status(404).json({ success: false, error: "WebAuthn kimlik doğrulayıcı bulunamadı" });
    return;
  }

  await securityChange(req, "security.webauthn.remove", tx => tx.webAuthnCredential.delete({ where: { id: credential.id } }));

  await logAuditEvent({
    userId: req.user!.userId,
    action: "security.webauthn.remove",
    status: "success",
    ipAddress: getRequestIp(req),
    userAgent: getRequestUserAgent(req),
  });

  res.json({ success: true, data: { message: "WebAuthn kimlik doğrulayıcı kaldırıldı" } });
}));

export async function verifyWebAuthnLogin(
  userId: string,
  response: unknown,
  challengeToken: unknown,
  ceremony = "login"
) {
  const expectedChallenge = consumeAuthenticationChallengeToken(challengeToken, `${userId}:${ceremony}`);
  if (!expectedChallenge) {
    return false;
  }

  const dbCredential = await prisma.webAuthnCredential.findUnique({
    where: { credentialId: (response as AuthenticationResponseJSON | undefined)?.id ?? "" },
  });

  if (!dbCredential || dbCredential.userId !== userId) {
    return false;
  }

  const userHandle = (response as AuthenticationResponseJSON)?.response?.userHandle;
  if (userHandle != null && userHandle !== Buffer.from(userId).toString('base64url')) return false;
  const verification = await verifyAuthenticationResponse({
    response: response as AuthenticationResponseJSON,
    expectedChallenge,
    expectedOrigin: getWebAuthnLoginOrigins(),
    expectedRPID: getWebAuthnRpId(),
    credential: {
      id: dbCredential.credentialId,
      publicKey: Buffer.from(dbCredential.publicKey, "base64url"),
      counter: dbCredential.counter,
      transports: parseTransports(dbCredential.transports) as AuthenticatorTransportFuture[] | undefined,
    },
    requireUserVerification: false,
  });

  if (!verification.verified) {
    return false;
  }

  // Compare-and-set prevents a slower native assertion from moving the
  // counter backwards. Zero-counter portable credentials remain supported.
  const updated = await prisma.webAuthnCredential.updateMany({
    where: { id: dbCredential.id, userId, counter: dbCredential.counter },
    data: {
      counter: verification.authenticationInfo.newCounter,
      lastUsedAt: new Date(),
      deviceType: verification.authenticationInfo.credentialDeviceType,
      backedUp: verification.authenticationInfo.credentialBackedUp,
    },
  });

  return updated.count === 1;
}

export async function createWebAuthnLoginOptions(userId: string, ceremony = "login") {
  const credentials = await prisma.webAuthnCredential.findMany({ where: { userId } });
  const options = await generateAuthenticationOptions({
    rpID: getWebAuthnRpId(),
    timeout: 60_000,
    userVerification: "preferred",
    allowCredentials: credentials.map((credential) => ({
      id: credential.credentialId,
      transports: parseTransports(credential.transports) as AuthenticatorTransportFuture[] | undefined,
    })),
  });

  return {
    options,
    challengeToken: createAuthenticationChallengeToken(`${userId}:${ceremony}`, options.challenge),
  };
}

export default router;
