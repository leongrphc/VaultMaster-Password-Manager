import test from 'node:test';
import assert from 'node:assert/strict';
import { createExchangeIdentity, contactFingerprint, sealExchange, openExchange, verifyExchangeEnvelope, createVaultKey, wrapExchangeIdentity, unwrapExchangeIdentity, wrapVaultKey, unwrapVaultKey } from '../dist/index.js';
async function fixture(kind = 'share') {
  const sender = await createExchangeIdentity(), recipient = await createExchangeIdentity();
  const context = { id: crypto.randomUUID(), kind, sender: await contactFingerprint(sender.card), recipient: await contactFingerprint(recipient.card), expiresAt: new Date(Date.now() + 3600000).toISOString(), revision: 0 };
  const payload = { password: 'synthetic-secret', nested: ['ü', 1], snapshotKey: crypto.randomUUID() };
  const envelope = await sealExchange(payload, sender, recipient.card, context);
  return { sender, recipient, context, payload, envelope };
}
test('authenticated agreement encrypts only for the pinned recipient and randomizes every envelope', async () => {
  const f = await fixture();
  assert.deepEqual(await openExchange(f.envelope, f.recipient, f.sender.card, f.context), f.payload);
  assert.equal(await verifyExchangeEnvelope(f.envelope, f.sender.card, f.recipient.card, f.context), true);
  const next = await sealExchange(f.payload, f.sender, f.recipient.card, f.context);
  assert.notEqual(next.ephemeral, f.envelope.ephemeral); assert.notEqual(next.iv, f.envelope.iv); assert.notEqual(next.ciphertext, f.envelope.ciphertext);
  const uploaded = JSON.stringify(f.envelope);
  for (const secret of [f.payload.password, f.sender.signingPrivate, f.recipient.agreementPrivate, f.payload.snapshotKey]) assert.ok(!uploaded.includes(secret));
});
test('all authenticated fields, signature, ciphertext, device, purpose, expiry and revision fail closed', async () => {
  const f = await fixture();
  for (const field of ['id', 'kind', 'sender', 'recipient', 'expiresAt', 'revision']) {
    const context = { ...f.context, [field]: { id: crypto.randomUUID(), kind: 'emergency', sender: 'a'.repeat(64), recipient: 'b'.repeat(64), expiresAt: new Date(Date.now() + 7200000).toISOString(), revision: 1 }[field] };
    await assert.rejects(openExchange({ ...f.envelope, context }, f.recipient, f.sender.card, f.context), /verification failed/);
  }
  for (const field of ['ephemeral', 'iv', 'ciphertext', 'signature']) {
    const raw = Buffer.from(f.envelope[field], 'base64'); raw[raw.length - 1] ^= 1;
    await assert.rejects(openExchange({ ...f.envelope, [field]: raw.toString('base64') }, f.recipient, f.sender.card, f.context), /verification failed/);
  }
  await assert.rejects(openExchange(f.envelope, await createExchangeIdentity(), f.sender.card, f.context));
  await assert.rejects(openExchange(f.envelope, f.recipient, (await createExchangeIdentity()).card, f.context));
  await assert.rejects(openExchange({ ...f.envelope, extra: 'ignored?' }, f.recipient, f.sender.card, f.context));
  await assert.rejects(openExchange(f.envelope, f.recipient, f.sender.card, { ...f.context, expiresAt: new Date(0).toISOString() }));
});
test('device identity wrapper survives password rewrap but rejects key/device/card substitution', async () => {
  const identity = await createExchangeIdentity(), dek = await createVaultKey(), passwordKey = await createVaultKey(), device = crypto.randomUUID();
  const wrapped = await wrapExchangeIdentity(identity, dek, device);
  const recoveredDek = await unwrapVaultKey(await wrapVaultKey(dek, passwordKey), passwordKey);
  assert.deepEqual(await unwrapExchangeIdentity(wrapped, identity.card, recoveredDek, device), identity);
  await assert.rejects(unwrapExchangeIdentity(wrapped, identity.card, dek, crypto.randomUUID()));
  await assert.rejects(unwrapExchangeIdentity(wrapped, (await createExchangeIdentity()).card, dek, device));
  await assert.rejects(unwrapExchangeIdentity(wrapped, identity.card, await createVaultKey(), device));
  assert.ok(!JSON.stringify(wrapped).includes(identity.signingPrivate));
});
test('emergency envelope is purpose-bound and rejects malformed encodings and oversized snapshots', async () => {
  const f = await fixture('emergency');
  assert.deepEqual(await openExchange(f.envelope, f.recipient, f.sender.card, f.context), f.payload);
  await assert.rejects(openExchange(f.envelope, f.recipient, f.sender.card, { ...f.context, kind: 'share' }));
  await assert.rejects(sealExchange('x'.repeat(2_000_001), f.sender, f.recipient.card, f.context));
  await assert.rejects(contactFingerprint({ ...f.sender.card, agreement: 'A'.repeat(88) }));
  await assert.rejects(contactFingerprint({ ...f.sender.card, privateKey: 'must reject' }));
});
