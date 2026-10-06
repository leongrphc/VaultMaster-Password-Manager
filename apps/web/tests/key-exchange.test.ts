import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { createExchangeIdentity, createVaultKey, exportMasterKeyBase64, wrapExchangeIdentity, sealExchange, contactFingerprint, encryptJSON, decryptJSON } from '@vaultmaster/crypto';
import { api } from '@/lib/api';
import { useStore } from '@/lib/store';
import { enrollExchangeDevice, createExchange, exchangeAction, reviewExchange, rotateExchangeDevice, verifyContact } from '@/lib/key-exchange';
vi.mock('@/lib/api', () => ({ api: { exchange: { call: vi.fn() }, vault: { getAll: vi.fn() }, backups: { snapshot: vi.fn(), importState: vi.fn() } } }));
let locked = false;
let local: Awaited<ReturnType<typeof createExchangeIdentity>>;
let remote: typeof local;
let key: CryptoKey;
const call = vi.mocked(api.exchange.call);
const deviceId = '00000000-0000-4000-8000-000000000001';
beforeEach(async () => {
  vi.clearAllMocks(); locked = false; local = await createExchangeIdentity(); remote = await createExchangeIdentity(); key = await createVaultKey();
  const wrapped = await wrapExchangeIdentity(local, key, deviceId);
  const guard = () => { if (locked) throw new Error('locked'); };
  useStore.setState({ currentDeviceId: deviceId, masterKeyBase64: await exportMasterKeyBase64(key), isAuthenticated: true, isLocked: false,
    items: [{ id: crypto.randomUUID(), data: { type: 'login', title: 'synthetic', password: 'synthetic-secret', username: 'fixture', url: 'https://example.test' }, favorite: false, folderId: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
    getVaultOperationGuard: () => guard, loadVault: async () => { guard(); }, runWithValidAccessToken: async operation => operation('cookie-session') });
  const item = useStore.getState().items[0], encryptedItem = await encryptJSON(item.data, key);
  vi.mocked(api.vault.getAll).mockResolvedValue({ data: [{ ...item, data: undefined, deletedAt: null, encryptedData: encryptedItem.ciphertext, iv: encryptedItem.iv }] } as never);
  call.mockImplementation(async path => path === '/key' ? { data: { card: local.card, wrapped: wrapped.ciphertext, iv: wrapped.iv } } as never : { data: null } as never);
});
afterEach(() => { vi.restoreAllMocks(); });
describe('client key exchange', () => {
  it('enrolls ciphertext only, never sends identity private material or stable personal data', async () => {
    await enrollExchangeDevice();
    const body = call.mock.calls[0][2] as { wrapped: string; card: unknown; iv: string };
    expect(body.wrapped).toBeTruthy(); expect(body.iv).toHaveLength(16);
    expect(JSON.stringify(body)).not.toContain('Private'); expect(JSON.stringify(body)).not.toContain('@');
  });
  it('sharing serializes selected content into a signed encrypted snapshot and uses no email directory', async () => {
    const id = useStore.getState().items[0].id;
    await createExchange(JSON.stringify(remote.card), 'share', 7, 24, [id]);
    const [, method, body] = call.mock.calls.at(-1)!;
    expect(method).toBe('POST'); expect(JSON.stringify(body)).not.toContain('synthetic-secret');
    expect((body as { envelope: unknown }).envelope).toBeTruthy();
    await expect(createExchange(JSON.stringify(remote.card), 'share', 7, 24, [crypto.randomUUID()])).rejects.toThrow();
  });
  it('deleted, changed or unavailable live items cannot be shared from stale/offline client state', async () => {
    const id = useStore.getState().items[0].id;
    vi.mocked(api.vault.getAll).mockRejectedValueOnce(new Error('network'));
    await expect(createExchange(JSON.stringify(remote.card), 'share', 7, 24, [id])).rejects.toThrow();
    vi.mocked(api.vault.getAll).mockResolvedValueOnce({ data: [] } as never);
    await expect(createExchange(JSON.stringify(remote.card), 'share', 7, 24, [id])).rejects.toThrow();
    const response = await api.vault.getAll('cookie-session') as { data: Array<{ updatedAt: string }> };
    vi.mocked(api.vault.getAll).mockResolvedValueOnce({ data: response.data.map(item => ({ ...item, updatedAt: new Date(0).toISOString() })) } as never);
    await expect(createExchange(JSON.stringify(remote.card), 'share', 7, 24, [id])).rejects.toThrow();
    expect(call.mock.calls.every(args => args[0] === '/key')).toBe(true);
  });
  it('emergency invitation contains no encrypted recovery payload, source data key or private keys', async () => {
    await createExchange(JSON.stringify(remote.card), 'emergency', 7, 24, []);
    const body = call.mock.calls.at(-1)![2]; expect(body).not.toHaveProperty('envelope'); expect(JSON.stringify(body)).not.toContain(useStore.getState().masterKeyBase64!);
    expect(api.backups.snapshot).not.toHaveBeenCalled();
  });
  it('pin mismatch stops acceptance before mutation and lock stops late encryption writes', async () => {
    const record = { id: crypto.randomUUID(), senderCard: remote.card, recipientCard: local.card, kind: 'share' as const, revision: 0, status: 'pending', expiresAt: new Date(Date.now() + 86400000).toISOString(), waitHours: 24, requestedAt: null };
    await expect(exchangeAction(record, 'accept', JSON.stringify(local.card))).rejects.toThrow();
    expect(call).toHaveBeenCalledTimes(1);
    call.mockImplementationOnce(async () => { locked = true; return { data: null } as never; });
    await expect(createExchange(JSON.stringify(remote.card), 'share', 7, 24, [])).rejects.toThrow();
    expect(call).toHaveBeenCalledTimes(2);
  });
  it('received snapshots are re-encrypted for the destination and conflicts require review without automatic writes', async () => {
    const snapshotKey = await createVaultKey(), id = crypto.randomUUID(), now = new Date().toISOString();
    const data = { type: 'login' as const, title: 'fixture', url: 'https://example.test', username: 'fixture', password: 'received-secret' };
    const encrypted = await encryptJSON(data, snapshotKey);
    const snapshot = { folders: [], items: [{ id: crypto.randomUUID(), encryptedData: encrypted.ciphertext, iv: encrypted.iv, favorite: false, folderId: null, deletedAt: null, createdAt: now, updatedAt: now, versions: [], attachments: [] }] };
    const expiresAt = new Date(Date.now() + 86400000).toISOString();
    const context = { id, kind: 'share' as const, sender: await contactFingerprint(remote.card), recipient: await contactFingerprint(local.card), expiresAt, revision: 0 };
    const envelope = await sealExchange({ version: 1, scope: 'personal-snapshot', backupId: id, key: await exportMasterKeyBase64(snapshotKey), snapshot }, remote, local.card, context);
    const record = { id, kind: 'share' as const, status: 'accepted', revision: 1, expiresAt, waitHours: 24, requestedAt: null, senderCard: remote.card, recipientCard: local.card };
    call.mockImplementationOnce(call.getMockImplementation()!).mockResolvedValueOnce({ data: { ...record, envelope } } as never);
    const current = await encryptJSON({ ...data, password: 'old-secret' }, key);
    vi.mocked(api.backups.importState).mockResolvedValue({ data: { state: 'a'.repeat(64), folders: [], items: [{ ...snapshot.items[0], id: crypto.randomUUID(), encryptedData: current.ciphertext, iv: current.iv, _count: { versions: 0, attachments: 0 } }] } });
    const review = await reviewExchange(record, JSON.stringify(remote.card));
    expect(review.rows[0].kind).toBe('same-login'); expect(review.body.backupId).toBe(id);
    const received = review.body.snapshot.items[0];
    expect(await decryptJSON(received.encryptedData, received.iv, key)).toEqual(data);
    expect(JSON.stringify(review)).not.toContain('received-secret'); expect(call.mock.calls.filter(c => c[0] === '').length).toBe(0);
  });
  it('rotation only deletes the device key and does not create a replacement without a separate approval', async () => {
    await rotateExchangeDevice(); expect(call.mock.calls).toEqual([['/key', 'DELETE']]);
    await expect(verifyContact(JSON.stringify(local.card), remote.card)).rejects.toThrow();
  });
});
