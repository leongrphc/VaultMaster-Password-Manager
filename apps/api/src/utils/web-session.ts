import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

export const ACCESS_COOKIE = "__Host-vaultmaster-access";
export const REFRESH_COOKIE = "__Host-vaultmaster-refresh";
export function isWebClient(req: Request) { return req.headers["x-vaultmaster-client"] === "web"; }
const cookieOptions = { httpOnly: true, secure: true, sameSite: "strict" as const, path: "/" };
export function setWebSession(res: Response, access: string, refresh: string) {
  for (const [name, token] of [[ACCESS_COOKIE, access], [REFRESH_COOKIE, refresh]] as const) {
    const claims = jwt.decode(token) as { exp: number };
    res.cookie(name, token, { ...cookieOptions, expires: new Date(claims.exp * 1000) });
  }
  res.setHeader("Cache-Control", "no-store");
}
export function clearWebSession(res: Response) {
  res.clearCookie(ACCESS_COOKIE, cookieOptions);
  res.clearCookie(REFRESH_COOKIE, cookieOptions);
}

// A custom header alone is insufficient when an API has multiple origins.
// Require an exact trusted Origin for every cookie-authenticated mutation.
export function webSessionProtection(req: Request, res: Response, next: NextFunction) {
  if (req.headers.authorization?.startsWith("Bearer ") && !isWebClient(req)) { next(); return; }
  const usesCookies = Boolean(req.cookies?.[ACCESS_COOKIE] || req.cookies?.[REFRESH_COOKIE]);
  if (!usesCookies && !isWebClient(req)) { next(); return; }
  const unsafe = !["GET", "HEAD", "OPTIONS"].includes(req.method);
  const origin = req.headers.origin;
  if (!isWebClient(req) || req.headers["sec-fetch-site"] === "cross-site" ||
      (unsafe && (!origin || !env.CORS_ORIGIN.includes(origin)))) {
    res.status(403).json({ success: false, error: "Web isteğinin kaynağı doğrulanamadı." }); return;
  }
  res.setHeader("Cache-Control", "no-store");
  next();
}
