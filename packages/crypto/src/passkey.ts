// Software authenticator, version 1. Callers enforce trusted UI approval and an
// unlocked, live vault session. Never expose this module to page message handlers.
export interface PasskeyRequest {
  credProps?: boolean;
  challenge: string;
  rpId: string;
  origin: string;
  user?: { id: string; name: string };
  allowCredentials?: string[];
  excludeCredentials?: string[];
}
export interface StoredPasskey {
  rpId: string; credentialId: string; userHandle: string;
  privateKey: string; publicKey?: string;
}
const PREFIX = 'vm-passkey-v1:';
const encoder = new TextEncoder();
export function passkeyBase64(bytes: Uint8Array): string {
  let value = ''; for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
export function passkeyBytes(value: string, max = 4096): Uint8Array<ArrayBuffer> {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value) || value.length > Math.ceil(max * 4 / 3)) throw new Error('Invalid passkey data');
  const bytes = Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
  if (bytes.length > max || passkeyBase64(bytes) !== value) throw new Error('Invalid passkey data');
  return bytes;
}
function join(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.length; } return bytes;
}
function head(type: number, n: number): Uint8Array {
  return n < 24 ? Uint8Array.of(type << 5 | n) : n < 256 ? Uint8Array.of(type << 5 | 24, n) : Uint8Array.of(type << 5 | 25, n >> 8, n & 255);
}
function cbor(value: number | string | Uint8Array | Map<number | string, unknown>): Uint8Array {
  if (typeof value === 'number') return head(value < 0 ? 1 : 0, value < 0 ? -1 - value : value);
  if (typeof value === 'string') { const bytes = encoder.encode(value); return join(head(3, bytes.length), bytes); }
  if (value instanceof Uint8Array) return join(head(2, value.length), value);
  return join(head(5, value.size), ...[...value].flatMap(([key, entry]) => [cbor(key), cbor(entry as Parameters<typeof cbor>[0])]));
}
export function validatePasskeyRequest(request: PasskeyRequest): void {
  const url = new URL(request.origin);
  // Exact-host scope avoids accepting public suffixes without a browser PSL.
  if (url.origin !== request.origin || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) ||
    request.rpId !== url.hostname || !request.rpId) throw new Error('Invalid passkey scope');
  const challenge = passkeyBytes(request.challenge, 1024);
  if (challenge.length < 16) throw new Error('Invalid passkey challenge');
  if (request.user && (!request.user.name || request.user.name.length > 256 || passkeyBytes(request.user.id, 64).length === 0)) throw new Error('Invalid passkey user');
  for (const ids of [request.allowCredentials, request.excludeCredentials]) {
    if (ids && (!Array.isArray(ids) || ids.length > 64)) throw new Error('Invalid passkey descriptors');
    for (const id of ids || []) passkeyBytes(id, 1024);
  }
}
function clientData(request: PasskeyRequest, type: string): Uint8Array<ArrayBuffer> {
  return encoder.encode(JSON.stringify({ type, challenge: request.challenge, origin: request.origin, crossOrigin: false }));
}
async function authData(rpId: string, registration?: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(rpId)));
  // UP after explicit protected UI action; BE because the encrypted vault key is
  // portable; BS remains unset (no verified secondary backup); UV is never set.
  // Counter stays zero: encrypted restores and multiple clients cannot safely
  // coordinate a monotonically increasing counter.
  return join(hash, Uint8Array.of(registration ? 0x49 : 0x09, 0, 0, 0, 0), ...(registration ? [registration] : []));
}
export async function createStoredPasskey(request: PasskeyRequest, existing: StoredPasskey[]) {
  validatePasskeyRequest(request);
  if (!request.user) throw new Error('Missing passkey user');
  if (existing.some(key => key.rpId === request.rpId && (request.excludeCredentials || []).includes(key.credentialId))) throw new Error('Passkey already exists');
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', keys.publicKey);
  const publicKey = passkeyBase64(cbor(new Map<number, unknown>([[1, 2], [3, -7], [-1, 1], [-2, passkeyBytes(jwk.x!, 32)], [-3, passkeyBytes(jwk.y!, 32)]])));
  const credentialId = passkeyBase64(crypto.getRandomValues(new Uint8Array(32)));
  const stored: StoredPasskey = { rpId: request.rpId, credentialId, userHandle: request.user.id, publicKey,
    privateKey: PREFIX + JSON.stringify({ origin: request.origin, rpId: request.rpId, credentialId, userHandle: request.user.id, publicKey,
      pkcs8: passkeyBase64(new Uint8Array(await crypto.subtle.exportKey('pkcs8', keys.privateKey))) }) };
  const data = await authData(request.rpId, join(new Uint8Array(16), Uint8Array.of(0, 32), passkeyBytes(credentialId), passkeyBytes(publicKey)));
  return { stored, response: { id: credentialId, rawId: credentialId, type: 'public-key' as const,
    clientExtensionResults: request.credProps ? { credProps: { rk: true } } : {}, response: {
      clientDataJSON: passkeyBase64(clientData(request, 'webauthn.create')), authenticatorData: passkeyBase64(data), publicKeyAlgorithm: -7, publicKey: passkeyBase64(new Uint8Array(await crypto.subtle.exportKey('spki', keys.publicKey))),
      attestationObject: passkeyBase64(cbor(new Map<string, unknown>([['fmt', 'none'], ['attStmt', new Map()], ['authData', data]]))), transports: [] } } };
}
function derSignature(raw: Uint8Array): Uint8Array {
  if (raw.length !== 64) throw new Error('Invalid signature');
  const integer = (bytes: Uint8Array) => {
    let start = 0; while (start < bytes.length - 1 && bytes[start] === 0) ++start;
    const value = bytes.slice(start); const positive = value[0]! & 128 ? join(Uint8Array.of(0), value) : value;
    return join(Uint8Array.of(2, positive.length), positive);
  };
  const value = join(integer(raw.slice(0, 32)), integer(raw.slice(32))); return join(Uint8Array.of(48, value.length), value);
}
export function isStoredPasskey(key: StoredPasskey): boolean { return key.privateKey.startsWith(PREFIX); }
export async function signStoredPasskey(request: PasskeyRequest, stored: StoredPasskey) {
  validatePasskeyRequest(request);
  if (!isStoredPasskey(stored) || stored.rpId !== request.rpId || (request.allowCredentials?.length && !request.allowCredentials.includes(stored.credentialId))) throw new Error('Passkey not available');
  const envelope = JSON.parse(stored.privateKey.slice(PREFIX.length));
  if (envelope.origin !== request.origin || envelope.rpId !== stored.rpId || envelope.credentialId !== stored.credentialId || envelope.userHandle !== stored.userHandle || envelope.publicKey !== stored.publicKey) throw new Error('Invalid passkey binding');
  const key = await crypto.subtle.importKey('pkcs8', passkeyBytes(envelope.pkcs8, 256), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const client = clientData(request, 'webauthn.get'), data = await authData(request.rpId);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', client));
  const signature = derSignature(new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, join(data, hash))));
  return { id: stored.credentialId, rawId: stored.credentialId, type: 'public-key' as const,
    clientExtensionResults: {}, response: {
      clientDataJSON: passkeyBase64(client), authenticatorData: passkeyBase64(data), signature: passkeyBase64(signature), userHandle: stored.userHandle } };
}
