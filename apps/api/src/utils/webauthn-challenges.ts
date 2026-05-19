import crypto from "node:crypto";

interface StoredChallenge {
  challenge: string;
  userId: string;
  expiresAt: number;
}

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const registrationChallenges = new Map<string, StoredChallenge>();
const authenticationChallenges = new Map<string, StoredChallenge>();

function pruneExpired(store: Map<string, StoredChallenge>) {
  const now = Date.now();
  for (const [key, value] of store.entries()) {
    if (value.expiresAt <= now) {
      store.delete(key);
    }
  }
}

export function createChallengeToken(
  store: Map<string, StoredChallenge>,
  userId: string,
  challenge: string
) {
  pruneExpired(store);
  const token = crypto.randomBytes(32).toString("base64url");
  store.set(token, {
    userId,
    challenge,
    expiresAt: Date.now() + CHALLENGE_TTL_MS,
  });
  return token;
}

export function consumeChallengeToken(
  store: Map<string, StoredChallenge>,
  token: unknown,
  userId: string
) {
  pruneExpired(store);

  if (typeof token !== "string" || !token) {
    return null;
  }

  const entry = store.get(token);
  store.delete(token);

  if (!entry || entry.userId !== userId || entry.expiresAt <= Date.now()) {
    return null;
  }

  return entry.challenge;
}

export function createRegistrationChallengeToken(userId: string, challenge: string) {
  return createChallengeToken(registrationChallenges, userId, challenge);
}

export function consumeRegistrationChallengeToken(token: unknown, userId: string) {
  return consumeChallengeToken(registrationChallenges, token, userId);
}

export function createAuthenticationChallengeToken(userId: string, challenge: string) {
  return createChallengeToken(authenticationChallenges, userId, challenge);
}

export function consumeAuthenticationChallengeToken(token: unknown, userId: string) {
  return consumeChallengeToken(authenticationChallenges, token, userId);
}
