import { createHash } from 'node:crypto';
import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { exchangeKeySchema, exchangeCreateSchema, exchangeActionSchema, vaultItemIdSchema, type ExchangeRecord } from '@vaultmaster/shared';
import { contactFingerprint, verifyExchangeEnvelope, type ContactCard, type ExchangeContext } from '@vaultmaster/crypto';
import { prisma } from '../config/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { asyncRoute } from '../utils/async-route.js';
import { assertReauthenticated, securityNotification } from '../utils/security-notifications.js';
const router: Router = Router();
router.use(authMiddleware);
router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
const unavailable = () => Object.assign(new Error('Exchange unavailable'), { exchange: true });
// Lock both principals before the existing reauthentication helper. Otherwise
// opposing approvals can deadlock when notification FKs lock the other account.
async function lockPrincipals(tx: Prisma.TransactionClient, deviceIds: string[]) {
  const devices = await tx.device.findMany({ where: { id: { in: deviceIds } } });
  if (devices.length !== new Set(deviceIds).size) throw unavailable();
  for (const userId of [...new Set(devices.map(d => d.userId))].sort()) await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
  for (const deviceId of [...new Set(deviceIds)].sort()) await tx.$queryRaw`SELECT id FROM devices WHERE id = ${deviceId} FOR UPDATE`;
}
async function lockKeys(tx: Prisma.TransactionClient, ids: string[]) {
  // Stable ordering serializes rotation, grant/revoke and device removal.
  for (const id of [...new Set(ids)].sort()) await tx.$queryRaw`SELECT id FROM exchange_keys WHERE id = ${id} FOR UPDATE`;
  const keys = await tx.exchangeKey.findMany({ where: { id: { in: ids } }, include: { device: true } });
  if (keys.length !== new Set(ids).size || keys.some(k => !k.device.refreshTokenHash || k.device.refreshTokenReusedAt)) throw unavailable();
  return keys;
}
async function notify(tx: Prisma.TransactionClient, userId: string) { await securityNotification(tx, userId, 'exchange.approval'); }
function card(value: Prisma.JsonValue): ContactCard { return value as unknown as ContactCard; }
function json(value: unknown): Prisma.InputJsonValue { return value as Prisma.InputJsonValue; }
function project(g: Awaited<ReturnType<typeof getGrant>>, includeEnvelope = false): ExchangeRecord {
  return { id: g.id, kind: g.kind as 'share' | 'emergency', status: g.status, revision: g.revision, expiresAt: g.expiresAt.toISOString(), waitHours: g.waitHours, requestedAt: g.requestedAt?.toISOString() ?? null, senderCard: card(g.sender.card), recipientCard: card(g.recipient.card), ...(includeEnvelope ? { envelope: g.envelope as unknown as ExchangeRecord['envelope'] } : {}) };
}
async function getGrant(tx: Prisma.TransactionClient, id: string) {
  const grant = await tx.exchangeGrant.findUnique({ where: { id }, include: { sender: true, recipient: true } });
  if (!grant) throw unavailable(); return grant;
}
async function context(id: string, kind: 'share' | 'emergency', sender: ContactCard, recipient: ContactCard, expiresAt: string, revision: number): Promise<ExchangeContext> {
  return { id, kind, sender: await contactFingerprint(sender), recipient: await contactFingerprint(recipient), expiresAt, revision };
}
router.get('/key', asyncRoute(async (req, res) => {
  const key = await prisma.exchangeKey.findUnique({ where: { deviceId: req.user!.deviceId } });
  res.json({ success: true, data: key ? { card: key.card, wrapped: key.wrapped, iv: key.iv } : null });
}));
router.post('/key', asyncRoute(async (req, res) => {
  const body = exchangeKeySchema.parse(req.body);
  // Reject invalid curve points before storing a contact card.
  for (const [name, raw] of [['ECDH', body.card.agreement], ['ECDSA', body.card.signing]]) await crypto.subtle.importKey('raw', Uint8Array.from(Buffer.from(raw!, 'base64')), { name: name!, namedCurve: 'P-256' }, false, name === 'ECDSA' ? ['verify'] : []);
  await prisma.$transaction(async tx => {
    await assertReauthenticated(tx, req);
    const existing = await tx.exchangeKey.findUnique({ where: { deviceId: req.user!.deviceId } });
    if (existing) throw unavailable(); // Rotation uses explicit delete then enrollment.
    await tx.exchangeKey.create({ data: { id: body.card.id, deviceId: req.user!.deviceId, card: json(body.card), wrapped: body.wrapped, iv: body.iv } });
    await securityNotification(tx, req.user!.userId, 'exchange.key');
  });
  res.status(201).json({ success: true });
}));
router.delete('/key', asyncRoute(async (req, res) => {
  await prisma.$transaction(async tx => {
    await assertReauthenticated(tx, req);
    await tx.exchangeKey.deleteMany({ where: { deviceId: req.user!.deviceId } });
    await securityNotification(tx, req.user!.userId, 'exchange.key');
  }); res.json({ success: true });
}));
router.get('/', asyncRoute(async (req, res) => {
  const grants = await prisma.exchangeGrant.findMany({ where: { expiresAt: { gt: new Date() }, status: { not: 'revoked' }, OR: [{ sender: { deviceId: req.user!.deviceId } }, { recipient: { deviceId: req.user!.deviceId } }] }, include: { sender: true, recipient: true }, take: 100, orderBy: { expiresAt: 'asc' } });
  res.json({ success: true, data: grants.map(g => project(g)) });
}));
router.post('/', asyncRoute(async (req, res) => {
  const body = exchangeCreateSchema.parse(req.body);
  const expiresAt = new Date(body.expiresAt);
  if (expiresAt.getTime() <= Date.now() || expiresAt.getTime() > Date.now() + 30 * 86400000 || (body.kind === 'share') !== !!body.envelope) throw unavailable();
  const creationHash = createHash('sha256').update(JSON.stringify(body)).digest('hex');
  await prisma.$transaction(async tx => {
    const local = await tx.exchangeKey.findUnique({ where: { deviceId: req.user!.deviceId } });
    const recipient = await tx.exchangeKey.findUnique({ where: { id: body.recipient.id } });
    if (!local || !recipient || local.id === body.recipient.id) throw unavailable();
    await lockPrincipals(tx, [local.deviceId, recipient.deviceId]);
    await assertReauthenticated(tx, req);
    const keys = await lockKeys(tx, [local.id, body.recipient.id]);
    const remote = keys.find(k => k.id === body.recipient.id)!;
    if (remote.device.userId === req.user!.userId || await contactFingerprint(card(remote.card)) !== await contactFingerprint(body.recipient)) throw unavailable();
    if (body.envelope && !await verifyExchangeEnvelope(body.envelope, card(local.card), body.recipient, await context(body.id, body.kind, card(local.card), body.recipient, body.expiresAt, 0))) throw unavailable();
    const existing = await tx.exchangeGrant.findUnique({ where: { id: body.id } });
    if (existing) {
      if (existing.senderKeyId !== local.id || existing.creationHash !== creationHash || existing.status === 'revoked') throw unavailable();
      return; // Exact create retry has no new effect or notification.
    }
    if (await tx.exchangeGrant.count({ where: { senderKeyId: local.id, expiresAt: { gt: new Date() }, status: { not: 'revoked' } } }) >= 100) throw unavailable();
    await tx.exchangeGrant.create({ data: { id: body.id, senderKeyId: local.id, recipientKeyId: remote.id, kind: body.kind, expiresAt, waitHours: body.waitHours, creationHash, envelope: body.envelope ? json(body.envelope) : undefined } });
    await notify(tx, req.user!.userId); await notify(tx, remote.device.userId);
  }); res.status(201).json({ success: true });
}));
router.post('/:id/:action', asyncRoute(async (req, res) => {
  const { id } = vaultItemIdSchema.parse({ id: req.params.id });
  const body = exchangeActionSchema.parse(req.body), action = req.params.action;
  if (!['accept', 'request', 'grant', 'reject', 'revoke', 'open'].includes(action as string)) throw unavailable();
  const result = await prisma.$transaction(async tx => {
    const initial = await getGrant(tx, id);
    if (![initial.sender.deviceId, initial.recipient.deviceId].includes(req.user!.deviceId)) throw unavailable();
    await lockPrincipals(tx, [initial.sender.deviceId, initial.recipient.deviceId]);
    await assertReauthenticated(tx, req);
    const keys = await lockKeys(tx, [initial.senderKeyId, initial.recipientKeyId]);
    await tx.$queryRaw`SELECT id FROM exchange_grants WHERE id = ${id} FOR UPDATE`;
    const g = await getGrant(tx, id);
    const owner = g.sender.deviceId === req.user!.deviceId, recipient = g.recipient.deviceId === req.user!.deviceId;
    if ((!owner && !recipient) || g.expiresAt.getTime() <= Date.now() || g.status === 'revoked' || g.revision !== body.revision || (action !== 'grant' && body.envelope)) throw unavailable();
    if (action === 'open') {
      if (!recipient || (g.kind === 'share' ? g.status !== 'accepted' : g.status !== 'granted')) throw unavailable();
      await notify(tx, req.user!.userId);
      return project(g, true); // Repeat reads are safe; approval is single-use.
    }
    let status: string;
    if (action === 'accept' && recipient && g.status === 'pending') status = 'accepted';
    else if (action === 'request' && recipient && g.kind === 'emergency' && g.status === 'accepted') status = 'requested';
    else if (action === 'grant' && owner && g.kind === 'emergency' && g.status === 'requested' && g.requestedAt && g.requestedAt.getTime() + g.waitHours * 3600000 <= Date.now() && body.envelope) {
      if (!await verifyExchangeEnvelope(body.envelope, card(g.sender.card), card(g.recipient.card), await context(g.id, 'emergency', card(g.sender.card), card(g.recipient.card), g.expiresAt.toISOString(), g.revision + 1))) throw unavailable();
      status = 'granted';
    } else if (action === 'reject' && owner && g.status === 'requested') status = 'accepted';
    else if (action === 'revoke' && (owner || recipient)) status = 'revoked';
    else throw unavailable();
    const updated = await tx.exchangeGrant.update({ where: { id }, data: { status, revision: { increment: 1 }, requestedAt: status === 'requested' ? new Date() : status === 'accepted' ? null : undefined } });
    // Revoke clears the payload in the same transaction.
    if (action === 'grant') await tx.exchangeGrant.update({ where: { id }, data: { envelope: json(body.envelope!) } });
    if (status === 'revoked') await tx.$executeRaw`UPDATE exchange_grants SET envelope = NULL WHERE id = ${id}`;
    for (const userId of new Set(keys.map(k => k.device.userId))) await notify(tx, userId);
    return { ...project(g), status: updated.status, revision: updated.revision, requestedAt: updated.requestedAt?.toISOString() ?? null };
  }); res.json({ success: true, data: result });
}));
router.use((error: Error & { exchange?: boolean }, _req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => {
  if (error.exchange || ('code' in error && ['P2002', 'P2003', 'P2025', 'P2034'].includes(String(error.code)))) { res.status(409).json({ success: false, error: 'Erişim kullanılamıyor. Yenileyip tekrar onaylayın.' }); return; }
  next(error);
});
export default router;
