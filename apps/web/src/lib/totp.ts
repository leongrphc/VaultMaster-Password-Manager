const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function decodeBase32(input: string): Uint8Array {
  const normalized = input.toUpperCase().replace(/=+$/g, "").replace(/[\s-]+/g, "");
  let bits = "";

  for (const character of normalized) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index === -1) {
      throw new Error("Geçersiz TOTP secret");
    }

    bits += index.toString(2).padStart(5, "0");
  }

  const bytes: number[] = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
    bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  }

  return new Uint8Array(bytes);
}

export function normalizeTotpSecret(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return "";
  }

  if (trimmed.toLowerCase().startsWith("otpauth://")) {
    try {
      const url = new URL(trimmed);
      return (url.searchParams.get("secret") ?? "").trim();
    } catch {
      throw new Error("Geçersiz otpauth bağlantısı");
    }
  }

  return trimmed;
}

export async function generateTotpCode(secretInput: string): Promise<{
  code: string;
  period: number;
  expiresIn: number;
}> {
  const secret = normalizeTotpSecret(secretInput);
  const period = 30;
  const counter = Math.floor(Date.now() / 1000 / period);
  const counterBuffer = new ArrayBuffer(8);
  const counterView = new DataView(counterBuffer);
  const secretBytes = decodeBase32(secret);
  const keyMaterial = secretBytes.buffer.slice(
    secretBytes.byteOffset,
    secretBytes.byteOffset + secretBytes.byteLength
  ) as ArrayBuffer;

  counterView.setUint32(4, counter, false);

  const key = await crypto.subtle.importKey(
    "raw",
    keyMaterial,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign("HMAC", key, counterBuffer);
  const hmac = new Uint8Array(signature);
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return {
    code: String(binary % 1_000_000).padStart(6, "0"),
    period,
    expiresIn: period - (Math.floor(Date.now() / 1000) % period),
  };
}
