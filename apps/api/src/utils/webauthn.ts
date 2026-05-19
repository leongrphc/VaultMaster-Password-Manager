import { env } from "../config/env.js";

export const rpName = "VaultMaster";

export function getWebAuthnOrigin() {
  return env.CORS_ORIGIN[0] ?? "http://localhost:3000";
}

export function getWebAuthnRpId() {
  const origin = getWebAuthnOrigin();
  return new URL(origin).hostname;
}

export function parseTransports(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : undefined;
}

export function credentialToResponse(credential: {
  id: string;
  credentialId: string;
  deviceType: string | null;
  backedUp: boolean;
  transports: unknown;
  name: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
}) {
  return {
    id: credential.id,
    credentialId: credential.credentialId,
    deviceType: credential.deviceType,
    backedUp: credential.backedUp,
    transports: credential.transports,
    name: credential.name,
    createdAt: credential.createdAt.toISOString(),
    lastUsedAt: credential.lastUsedAt?.toISOString() ?? null,
  };
}
