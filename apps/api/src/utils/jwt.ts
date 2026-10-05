import { createHmac, randomUUID } from "node:crypto";
import jwt, { type SignOptions } from "jsonwebtoken";
import { env } from "../config/env.js";

export interface TokenPayload {
  userId: string;
  email: string;
  deviceId: string;
}

const issuer = "vaultmaster-api";
const audience = "vaultmaster";

export function generateAccessToken(payload: TokenPayload): string {
  return jwt.sign({ ...payload, tokenUse: "access" }, env.JWT_SECRET, {
    algorithm: "HS256", issuer, audience, jwtid: randomUUID(),
    expiresIn: env.JWT_EXPIRES_IN as SignOptions["expiresIn"],
  });
}

export function generateRefreshToken(payload: TokenPayload): string {
  return jwt.sign({ ...payload, tokenUse: "refresh" }, env.JWT_REFRESH_SECRET, {
    algorithm: "HS256", issuer, audience, jwtid: randomUUID(),
    expiresIn: env.JWT_REFRESH_EXPIRES_IN as SignOptions["expiresIn"],
  });
}

function verifyToken(token: string, secret: string, tokenUse: "access" | "refresh"): TokenPayload {
  const payload = jwt.verify(token, secret, { algorithms: ["HS256"], issuer, audience });
  if (typeof payload === "string" || payload.tokenUse !== tokenUse ||
    typeof payload.userId !== "string" || !payload.userId ||
    typeof payload.email !== "string" || !payload.email ||
    typeof payload.deviceId !== "string" || !payload.deviceId ||
    typeof payload.jti !== "string" || !payload.jti) {
    throw new Error("Invalid token claims");
  }
  return { userId: payload.userId, email: payload.email, deviceId: payload.deviceId };
}

export function verifyAccessToken(token: string): TokenPayload {
  return verifyToken(token, env.JWT_SECRET, "access");
}

export function verifyRefreshToken(token: string): TokenPayload {
  return verifyToken(token, env.JWT_REFRESH_SECRET, "refresh");
}

export function hashRefreshToken(token: string): string {
  return createHmac("sha256", env.JWT_REFRESH_SECRET).update(token).digest("hex");
}
