import { z } from 'zod';
import { contactCardSchema, personalSnapshotSchema, type ExchangeRecord, type VaultItemData, type VaultItemResponse } from '@vaultmaster/shared';
import { createExchangeIdentity, wrapExchangeIdentity, unwrapExchangeIdentity, importMasterKey, createVaultKey, exportMasterKeyBase64, sealExchange, openExchange, contactFingerprint, decryptJSON, type ContactCard, type ExchangeIdentity } from '@vaultmaster/crypto';
import { api } from './api';
import { useStore } from './store';
import { prepareBackupRestore } from './full-backup';
import { legacyImportSnapshot, reviewImport, type ImportReview } from './import-conflicts';
const payloadSchema = z.object({ version: z.literal(1), scope: z.literal('personal-snapshot'), backupId: z.string().uuid(), key: z.string().regex(/^[A-Za-z0-9+/]{43}=$/), snapshot: personalSnapshotSchema }).strict();
export function readContactCard(text: string): ContactCard { return contactCardSchema.parse(JSON.parse(text)); }
export async function verifyContact(text: string, expected: ContactCard) {
  if (await contactFingerprint(readContactCard(text)) !== await contactFingerprint(expected)) throw new Error('Kişi kartı doğrulanamadı.');
}
function session() {
  const state = useStore.getState(), guard = state.getVaultOperationGuard(); guard();
  if (!state.currentDeviceId || !state.masterKeyBase64) throw new Error('Kasayı açın.');
  return { state, guard, deviceId: state.currentDeviceId, keyBase64: state.masterKeyBase64 };
}
async function identity(s: ReturnType<typeof session>): Promise<ExchangeIdentity> {
  const { data } = await api.exchange.call<{ card: ContactCard; wrapped: string; iv: string } | null>('/key'); s.guard();
  if (!data) throw new Error('Önce cihaz kişi kartı oluşturun.');
  const result = await unwrapExchangeIdentity({ ciphertext: data.wrapped, iv: data.iv }, data.card, await importMasterKey(s.keyBase64), s.deviceId); s.guard(); return result;
}
export async function enrollExchangeDevice() {
  const s = session(), local = await createExchangeIdentity(); s.guard();
  const wrapped = await wrapExchangeIdentity(local, await importMasterKey(s.keyBase64), s.deviceId); s.guard();
  await api.exchange.call('/key', 'POST', { card: local.card, wrapped: wrapped.ciphertext, iv: wrapped.iv }); s.guard();
  return local.card;
}
export async function getExchangeCard() { const s = session(); return (await identity(s)).card; }
export async function rotateExchangeDevice() {
  const s = session(); await api.exchange.call('/key', 'DELETE'); s.guard();
  // Explicit enrollment is a separate approved operation. Failure leaves no key.
}
export async function listExchanges() { const s = session(); const result = await api.exchange.call<ExchangeRecord[]>(''); s.guard(); return result.data; }
async function snapshotPayload(id: string, kind: 'share' | 'emergency', selected: string[], s: ReturnType<typeof session>) {
  const snapshotKey = await createVaultKey(), key = await exportMasterKeyBase64(snapshotKey); s.guard();
  let snapshot;
  if (kind === 'share') {
    // Read live ciphertext directly: ordinary vault sync can intentionally fall
    // back to an offline snapshot, which must never authorize a new share.
    const { data: records } = await s.state.runWithValidAccessToken(token => api.vault.getAll(token)) as { data: VaultItemResponse[] }; s.guard();
    const entries: Array<{ data: VaultItemData; favorite: boolean }> = [];
    if (!selected.length || new Set(selected).size !== selected.length) throw new Error('Seçilen öğe artık kullanılamıyor.');
    for (const id of selected) {
      const displayed = s.state.items.find(item => item.id === id), current = records.find(item => item.id === id && !item.deletedAt);
      if (!displayed || !current || displayed.updatedAt !== current.updatedAt || displayed.favorite !== current.favorite) throw new Error('Kasa değişti. Yenileyip tekrar onaylayın.');
      const data = await decryptJSON<VaultItemData>(current.encryptedData, current.iv, await importMasterKey(s.keyBase64)); s.guard();
      if (JSON.stringify(data) !== JSON.stringify(displayed.data)) throw new Error('Kasa değişti. Yenileyip tekrar onaylayın.');
      entries.push({ data, favorite: current.favorite });
    }
    snapshot = await legacyImportSnapshot({ items: entries }, key, s.guard);
  } else {
    const archive = await s.state.runWithValidAccessToken(token => api.backups.snapshot(token, s.guard)); s.guard();
    snapshot = (await prepareBackupRestore({ scope: 'personal-vault', ...archive.data, vaultKeyBase64: s.keyBase64 }, key, s.guard)).snapshot;
  }
  s.guard(); return { version: 1 as const, scope: 'personal-snapshot' as const, backupId: id, key, snapshot };
}
export async function createExchange(recipientText: string, kind: 'share' | 'emergency', days: number, waitHours: number, selected: string[]) {
  const s = session(), recipient = readContactCard(recipientText), local = await identity(s), id = crypto.randomUUID(); s.guard();
  const expiresAt = new Date(Date.now() + days * 86400000).toISOString();
  const context = { id, kind, sender: await contactFingerprint(local.card), recipient: await contactFingerprint(recipient), expiresAt, revision: 0 };
  const envelope = kind === 'share' ? await sealExchange(await snapshotPayload(id, kind, selected, s), local, recipient, context) : undefined;
  s.guard(); await api.exchange.call('', 'POST', { id, recipient, kind, expiresAt, waitHours, ...(envelope ? { envelope } : {}) }); s.guard();
}
export async function exchangeAction(record: ExchangeRecord, action: 'accept' | 'request' | 'reject' | 'revoke' | 'grant', pinnedCard: string) {
  const s = session(), local = await identity(s); s.guard();
  const owner = local.card.id === record.senderCard.id;
  if (action === 'accept' || action === 'grant') await verifyContact(pinnedCard, owner ? record.recipientCard : record.senderCard);
  let envelope;
  if (action === 'grant') {
    if (!record.requestedAt || Date.parse(record.requestedAt) + record.waitHours * 3600000 > Date.now()) throw new Error('Bekleme süresi tamamlanmadı.');
    envelope = await sealExchange(await snapshotPayload(record.id, 'emergency', [], s), local, record.recipientCard, { id: record.id, kind: 'emergency', sender: await contactFingerprint(local.card), recipient: await contactFingerprint(record.recipientCard), expiresAt: record.expiresAt, revision: record.revision + 1 });
  }
  s.guard(); await api.exchange.call(`/${record.id}/${action}`, 'POST', { revision: record.revision, ...(envelope ? { envelope } : {}) }); s.guard();
}
export async function reviewExchange(record: ExchangeRecord, pinnedSender: string): Promise<ImportReview> {
  const s = session(); await verifyContact(pinnedSender, record.senderCard); s.guard();
  const local = await identity(s); s.guard();
  const { data } = await api.exchange.call<ExchangeRecord>(`/${record.id}/open`, 'POST', { revision: record.revision }); s.guard();
  if (!data.envelope) throw new Error('Erişim kullanılamıyor.');
  const expected = { id: record.id, kind: record.kind, sender: await contactFingerprint(record.senderCard), recipient: await contactFingerprint(local.card), expiresAt: record.expiresAt, revision: record.kind === 'share' ? 0 : record.revision };
  const payload = payloadSchema.parse(await openExchange(data.envelope, local, record.senderCard, expected)); s.guard();
  if (payload.backupId !== record.id) throw new Error('Erişim kullanılamıyor.');
  const restored = await prepareBackupRestore({ scope: 'personal-vault', backupId: payload.backupId, exportedAt: new Date().toISOString(), sourceEmail: 'snapshot@example.invalid', vaultKeyBase64: payload.key, snapshot: payload.snapshot }, s.keyBase64, s.guard);
  s.guard(); const current = await s.state.runWithValidAccessToken(token => api.backups.importState(token)); s.guard();
  return reviewImport(restored, current.data, s.keyBase64, s.guard, true);
}
