import { prisma } from "../config/prisma.js";
import type { Request, Response, NextFunction } from "express";
import { verifyAccessToken, type TokenPayload } from "../utils/jwt.js";
import { ACCESS_COOKIE, isWebClient } from "../utils/web-session.js";

declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload;
    }
  }
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  const token = isWebClient(req) ? req.cookies?.[ACCESS_COOKIE] : authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;
  if (typeof token !== "string" || !token) {
    res.status(401).json({ success: false, error: "Yetkilendirme gerekli" });
    return;
  }

  let payload: TokenPayload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    res.status(401).json({ success: false, error: "Geçersiz veya süresi dolmuş token" });
    return;
  }

  try {
    const device = await prisma.device.findFirst({
      where: { id: payload.deviceId, userId: payload.userId,
        refreshTokenReusedAt: null, refreshTokenHash: { not: null } },
      select: { id: true },
    });
    if (!device) {
      res.status(401).json({ success: false, error: "Oturum sonlandırıldı. Tekrar giriş yapın." });
      return;
    }
    req.user = payload;
    next();
  } catch (error) {
    // A database outage is a server error, not an invalid login.
    next(error);
  }
}
