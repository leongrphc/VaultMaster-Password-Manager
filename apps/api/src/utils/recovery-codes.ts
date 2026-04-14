import crypto from "crypto";
import argon2 from "argon2";

const RECOVERY_CODE_COUNT = 8;

function generateRecoveryCode(): string {
  return `${crypto.randomBytes(2).toString("hex")}-${crypto.randomBytes(2).toString("hex")}-${crypto.randomBytes(2).toString("hex")}`.toUpperCase();
}

export async function createRecoveryCodes(): Promise<{
  plaintextCodes: string[];
  hashedCodes: string[];
}> {
  const plaintextCodes = Array.from({ length: RECOVERY_CODE_COUNT }, () =>
    generateRecoveryCode()
  );
  const hashedCodes = await Promise.all(
    plaintextCodes.map((code) =>
      argon2.hash(code, {
        type: argon2.argon2id,
        memoryCost: 19456,
        timeCost: 2,
        parallelism: 1,
      })
    )
  );

  return { plaintextCodes, hashedCodes };
}

export async function consumeRecoveryCode(
  storedHashes: string[] | null | undefined,
  candidate: string | undefined
): Promise<string[] | null> {
  if (!storedHashes || storedHashes.length === 0 || !candidate) {
    return null;
  }

  const normalizedCandidate = candidate.trim().toUpperCase();
  for (let index = 0; index < storedHashes.length; index += 1) {
    const currentHash = storedHashes[index];
    if (!currentHash) {
      continue;
    }

    if (await argon2.verify(currentHash, normalizedCandidate)) {
      return storedHashes.filter((_, currentIndex) => currentIndex !== index);
    }
  }

  return null;
}
