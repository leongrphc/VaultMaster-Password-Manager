import { decrypt, encrypt } from "@vaultmaster/crypto";

const LOCAL_UNLOCK_KEY = "vaultmaster-local-unlock";
const LOCAL_UNLOCK_LABEL = "VaultMaster local unlock";
const PRF_SALT_LENGTH = 32;

type LocalUnlockMethod = "platform-authenticator-prf";

export interface LocalUnlockStatus {
  enabled: boolean;
  createdAt: string | null;
  credentialId: string | null;
  method: LocalUnlockMethod | null;
}

interface LocalUnlockRecord {
  version: 1;
  method: LocalUnlockMethod;
  credentialId: string;
  prfSalt: string;
  encryptedMasterKey: string;
  iv: string;
  createdAt: string;
}

type PrfCredential = PublicKeyCredential & {
  getClientExtensionResults(): AuthenticationExtensionsClientOutputs & {
    prf?: {
      enabled?: boolean;
      results?: {
        first?: ArrayBuffer;
      };
    };
  };
};

function isBrowser() {
  return typeof window !== "undefined" && typeof navigator !== "undefined";
}

function getCrypto(): Crypto | null {
  if (!isBrowser()) {
    return null;
  }

  return window.crypto ?? null;
}

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  const cryptoApi = getCrypto();
  if (!cryptoApi) {
    throw new Error("Tarayıcı kripto API'si kullanılamıyor");
  }

  const bytes = new Uint8Array(new ArrayBuffer(length));
  cryptoApi.getRandomValues(bytes);
  return bytes;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function prfResultToAesKey(result: ArrayBuffer): Promise<CryptoKey> {
  const cryptoApi = getCrypto();
  if (!cryptoApi) {
    throw new Error("Tarayıcı kripto API'si kullanılamıyor");
  }

  const digest = await cryptoApi.subtle.digest("SHA-256", result);
  return cryptoApi.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function readRecord(): LocalUnlockRecord | null {
  if (!isBrowser()) {
    return null;
  }

  const raw = localStorage.getItem(LOCAL_UNLOCK_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<LocalUnlockRecord>;
    if (
      parsed.version !== 1 ||
      parsed.method !== "platform-authenticator-prf" ||
      typeof parsed.credentialId !== "string" ||
      typeof parsed.prfSalt !== "string" ||
      typeof parsed.encryptedMasterKey !== "string" ||
      typeof parsed.iv !== "string" ||
      typeof parsed.createdAt !== "string"
    ) {
      return null;
    }

    return parsed as LocalUnlockRecord;
  } catch {
    return null;
  }
}

function getPrfFirstResult(credential: PrfCredential): ArrayBuffer | null {
  const first = credential.getClientExtensionResults().prf?.results?.first;
  return first instanceof ArrayBuffer ? first : null;
}

export function isLocalUnlockSupported(): boolean {
  return Boolean(
    isBrowser() &&
      window.isSecureContext &&
      navigator.credentials &&
      typeof PublicKeyCredential !== "undefined"
  );
}

export function getLocalUnlockStatus(): LocalUnlockStatus {
  const record = readRecord();
  return {
    enabled: Boolean(record),
    createdAt: record?.createdAt ?? null,
    credentialId: record?.credentialId ?? null,
    method: record?.method ?? null,
  };
}

export async function setupLocalUnlock(params: {
  masterKeyBase64: string;
  userEmail: string;
  userId: string;
}): Promise<LocalUnlockStatus> {
  if (!isLocalUnlockSupported()) {
    throw new Error("Bu tarayıcıda platform doğrulayıcı ile yerel kilit açma desteklenmiyor");
  }

  const cryptoApi = getCrypto();
  if (!cryptoApi) {
    throw new Error("Tarayıcı kripto API'si kullanılamıyor");
  }

  const prfSalt = randomBytes(PRF_SALT_LENGTH);
  const challenge = randomBytes(32);
  const userIdBytes = new TextEncoder().encode(params.userId).slice(0, 64);

  const credential = (await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { name: LOCAL_UNLOCK_LABEL },
      user: {
        id: userIdBytes,
        name: params.userEmail,
        displayName: params.userEmail,
      },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        residentKey: "required",
        requireResidentKey: true,
        userVerification: "required",
      },
      extensions: {
        prf: {
          eval: { first: prfSalt },
        },
      } as AuthenticationExtensionsClientInputs,
      timeout: 60_000,
    },
  })) as PrfCredential | null;

  if (!credential) {
    throw new Error("Platform doğrulayıcı kurulumu iptal edildi");
  }

  const prfResult = getPrfFirstResult(credential);
  if (!prfResult) {
    throw new Error("Bu doğrulayıcı WebAuthn PRF uzantısını desteklemiyor");
  }

  const wrappingKey = await prfResultToAesKey(prfResult);
  const encrypted = await encrypt(params.masterKeyBase64, wrappingKey);
  const record: LocalUnlockRecord = {
    version: 1,
    method: "platform-authenticator-prf",
    credentialId: bytesToBase64Url(new Uint8Array(credential.rawId)),
    prfSalt: bytesToBase64Url(prfSalt),
    encryptedMasterKey: encrypted.ciphertext,
    iv: encrypted.iv,
    createdAt: new Date().toISOString(),
  };

  localStorage.setItem(LOCAL_UNLOCK_KEY, JSON.stringify(record));
  return getLocalUnlockStatus();
}

export async function unlockWithLocalAuthenticator(): Promise<string> {
  if (!isLocalUnlockSupported()) {
    throw new Error("Bu tarayıcıda platform doğrulayıcı ile yerel kilit açma desteklenmiyor");
  }

  const record = readRecord();
  if (!record) {
    throw new Error("Yerel kilit açma bu cihazda ayarlı değil");
  }

  const credential = (await navigator.credentials.get({
    publicKey: {
      challenge: randomBytes(32),
      allowCredentials: [
        {
          id: base64UrlToBytes(record.credentialId),
          type: "public-key",
          transports: ["internal"],
        },
      ],
      userVerification: "required",
      extensions: {
        prf: {
          eval: { first: base64UrlToBytes(record.prfSalt) },
        },
      } as AuthenticationExtensionsClientInputs,
      timeout: 60_000,
    },
  })) as PrfCredential | null;

  if (!credential) {
    throw new Error("Yerel doğrulama iptal edildi");
  }

  const prfResult = getPrfFirstResult(credential);
  if (!prfResult) {
    throw new Error("Yerel doğrulayıcı kilit materyalini üretemedi");
  }

  const wrappingKey = await prfResultToAesKey(prfResult);
  return decrypt(record.encryptedMasterKey, record.iv, wrappingKey);
}

export function clearLocalUnlock() {
  if (!isBrowser()) {
    return;
  }

  localStorage.removeItem(LOCAL_UNLOCK_KEY);
}
