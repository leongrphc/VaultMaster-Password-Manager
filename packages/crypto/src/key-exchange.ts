import { arrayBufferToBase64 as b64, base64ToArrayBuffer as bytes, stringToArrayBuffer as utf8, arrayBufferToHex } from './utils.js';

export interface ContactCard { version: 1; id: string; agreement: string; signing: string }
export interface ExchangeIdentity { card: ContactCard; agreementPrivate: string; signingPrivate: string }
export interface ExchangeContext { id: string; kind: 'share' | 'emergency'; sender: string; recipient: string; expiresAt: string; revision: number }
export interface ExchangeEnvelope { version: 1; context: ExchangeContext; ephemeral: string; iv: string; ciphertext: string; signature: string }
const fail = () => new Error('Key exchange verification failed');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function exact(value: object, fields: string[]) { if (Object.keys(value).sort().join() !== fields.sort().join()) throw fail(); }
function decode(value: string, length?: number) {
  if (typeof value !== 'string' || value.length > 4_000_000 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw fail();
  const raw = bytes(value); if (b64(raw) !== value || (length && raw.byteLength !== length)) throw fail(); return raw;
}
export function validateContactCard(card: ContactCard) {
  exact(card, ['version', 'id', 'agreement', 'signing']);
  if (card.version !== 1 || !uuid.test(card.id)) throw fail();
  for (const key of [card.agreement, card.signing]) if (new Uint8Array(decode(key, 65))[0] !== 4) throw fail();
  return card;
}
export async function contactFingerprint(card: ContactCard): Promise<string> {
  validateContactCard(card);
  return arrayBufferToHex(await crypto.subtle.digest('SHA-256', utf8(JSON.stringify([1, card.id, card.agreement, card.signing]))));
}
function header(context: ExchangeContext, ephemeral: string, iv: string) {
  exact(context, ['id', 'kind', 'sender', 'recipient', 'expiresAt', 'revision']);
  if (!uuid.test(context.id) || !['share', 'emergency'].includes(context.kind) || !/^[a-f0-9]{64}$/.test(context.sender) || !/^[a-f0-9]{64}$/.test(context.recipient) || !Number.isSafeInteger(context.revision) || context.revision < 0 || !Number.isFinite(Date.parse(context.expiresAt)) || new Date(context.expiresAt).toISOString() !== context.expiresAt) throw fail();
  decode(ephemeral, 65); decode(iv, 12);
  return utf8(JSON.stringify(['VaultMaster:key-exchange:v1', context.id, context.kind, context.sender, context.recipient, context.expiresAt, context.revision, ephemeral, iv]));
}
const ec = (name: string) => ({ name, namedCurve: 'P-256' });
export async function createExchangeIdentity(): Promise<ExchangeIdentity> {
  const agreement = await crypto.subtle.generateKey(ec('ECDH'), true, ['deriveBits']);
  const signing = await crypto.subtle.generateKey(ec('ECDSA'), true, ['sign', 'verify']);
  return { card: { version: 1, id: crypto.randomUUID(), agreement: b64(await crypto.subtle.exportKey('raw', agreement.publicKey)), signing: b64(await crypto.subtle.exportKey('raw', signing.publicKey)) },
    agreementPrivate: b64(await crypto.subtle.exportKey('pkcs8', agreement.privateKey)), signingPrivate: b64(await crypto.subtle.exportKey('pkcs8', signing.privateKey)) };
}
async function sharedKey(privateKey: CryptoKey, publicKey: string, aad: ArrayBuffer) {
  const remote = await crypto.subtle.importKey('raw', decode(publicKey, 65), ec('ECDH'), false, []);
  const raw = await crypto.subtle.deriveBits({ name: 'ECDH', public: remote }, privateKey, 256);
  const material = await crypto.subtle.importKey('raw', raw, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: await crypto.subtle.digest('SHA-256', aad), info: utf8('VaultMaster:exchange-payload:v1') }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
function signed(aad: ArrayBuffer, ciphertext: string) { return utf8(JSON.stringify([b64(aad), ciphertext])); }
export async function sealExchange(payload: unknown, identity: ExchangeIdentity, recipient: ContactCard, context: ExchangeContext): Promise<ExchangeEnvelope> {
  if (context.sender !== await contactFingerprint(identity.card) || context.recipient !== await contactFingerprint(recipient) || Date.parse(context.expiresAt) <= Date.now()) throw fail();
  const ephemeralKey = await crypto.subtle.generateKey(ec('ECDH'), false, ['deriveBits']);
  const ephemeral = b64(await crypto.subtle.exportKey('raw', ephemeralKey.publicKey));
  const iv = b64(crypto.getRandomValues(new Uint8Array(12)).buffer);
  const aad = header(context, ephemeral, iv), plaintext = utf8(JSON.stringify(payload));
  if (plaintext.byteLength > 2_000_000) throw fail();
  const key = await sharedKey(ephemeralKey.privateKey, recipient.agreement, aad);
  const ciphertext = b64(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: decode(iv, 12), additionalData: aad, tagLength: 128 }, key, plaintext));
  const signer = await crypto.subtle.importKey('pkcs8', decode(identity.signingPrivate), ec('ECDSA'), false, ['sign']);
  const signature = b64(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signer, signed(aad, ciphertext)));
  return { version: 1, context, ephemeral, iv, ciphertext, signature };
}
export async function openExchange<T>(envelope: ExchangeEnvelope, identity: ExchangeIdentity, pinnedSender: ContactCard, expected: ExchangeContext): Promise<T> {
  try {
    exact(envelope, ['version', 'context', 'ephemeral', 'iv', 'ciphertext', 'signature']);
    if (envelope.version !== 1 || Date.parse(expected.expiresAt) <= Date.now() || expected.sender !== await contactFingerprint(pinnedSender) || expected.recipient !== await contactFingerprint(identity.card)) throw fail();
    const aad = header(envelope.context, envelope.ephemeral, envelope.iv);
    if (b64(aad) !== b64(header(expected, envelope.ephemeral, envelope.iv))) throw fail();
    const verifier = await crypto.subtle.importKey('raw', decode(pinnedSender.signing, 65), ec('ECDSA'), false, ['verify']);
    if (!await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, verifier, decode(envelope.signature, 64), signed(aad, envelope.ciphertext))) throw fail();
    const privateKey = await crypto.subtle.importKey('pkcs8', decode(identity.agreementPrivate), ec('ECDH'), false, ['deriveBits']);
    const key = await sharedKey(privateKey, envelope.ephemeral, aad);
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(envelope.iv, 12), additionalData: aad, tagLength: 128 }, key, decode(envelope.ciphertext));
    if (plaintext.byteLength > 2_000_000) throw fail();
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext)) as T;
  } catch { throw fail(); }
}
// Identity is encrypted with a purpose/device-bound envelope, never generic JSON.
export async function wrapExchangeIdentity(identity: ExchangeIdentity, vaultKey: CryptoKey, deviceId: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: utf8(JSON.stringify(['VaultMaster:device-exchange-key:v1', deviceId, await contactFingerprint(identity.card)])) }, vaultKey, utf8(JSON.stringify(identity)));
  return { ciphertext: b64(ciphertext), iv: b64(iv.buffer) };
}
export async function unwrapExchangeIdentity(wrapped: { ciphertext: string; iv: string }, card: ContactCard, vaultKey: CryptoKey, deviceId: string): Promise<ExchangeIdentity> {
  try {
    const raw = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(wrapped.iv, 12), additionalData: utf8(JSON.stringify(['VaultMaster:device-exchange-key:v1', deviceId, await contactFingerprint(card)])) }, vaultKey, decode(wrapped.ciphertext));
    const identity = JSON.parse(new TextDecoder().decode(raw)) as ExchangeIdentity;
    exact(identity, ['card', 'agreementPrivate', 'signingPrivate']);
    if (await contactFingerprint(identity.card) !== await contactFingerprint(card)) throw fail();
    // Verify both private/public pairs before using a restored key.
    for (const [name, secret, publicRaw] of [['ECDH', identity.agreementPrivate, card.agreement], ['ECDSA', identity.signingPrivate, card.signing]]) {
      const imported = await crypto.subtle.importKey('pkcs8', decode(secret!), ec(name!), true, name === 'ECDH' ? ['deriveBits'] : ['sign']);
      const jwk = await crypto.subtle.exportKey('jwk', imported);
      delete jwk.d; delete jwk.key_ops;
      const publicKey = await crypto.subtle.importKey('jwk', jwk, ec(name!), true, name === 'ECDH' ? [] : ['verify']);
      if (b64(await crypto.subtle.exportKey('raw', publicKey)) !== publicRaw) throw fail();
    }
    return identity;
  } catch { throw fail(); }
}

export async function verifyExchangeEnvelope(envelope: ExchangeEnvelope, sender: ContactCard, recipient: ContactCard, expected: ExchangeContext) {
  try {
    exact(envelope, ['version', 'context', 'ephemeral', 'iv', 'ciphertext', 'signature']);
    if (envelope.version !== 1 || Date.parse(expected.expiresAt) <= Date.now() || expected.sender !== await contactFingerprint(sender) || expected.recipient !== await contactFingerprint(recipient)) return false;
    const aad = header(envelope.context, envelope.ephemeral, envelope.iv);
    if (b64(aad) !== b64(header(expected, envelope.ephemeral, envelope.iv))) return false;
    decode(envelope.ciphertext);
    const verifier = await crypto.subtle.importKey('raw', decode(sender.signing, 65), ec('ECDSA'), false, ['verify']);
    return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, verifier, decode(envelope.signature, 64), signed(aad, envelope.ciphertext));
  } catch { return false; }
}
