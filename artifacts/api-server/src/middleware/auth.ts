import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env["JWT_SECRET"] || process.env["SESSION_SECRET"] || "";
const JWT_EXPIRY = "7d";
const COOKIE_NAME = "mail_token";

if (!JWT_SECRET) {
  console.error("FATAL: JWT_SECRET or SESSION_SECRET must be set");
}

export interface JwtPayload {
  aliasEmail: string;
  tgUserId: number;
  dbKey: "bot1" | "bot2";
}

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export function signToken(payload: JwtPayload): string {
  if (!JWT_SECRET) throw new Error("JWT secret not configured");
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY });
}

export function setTokenCookie(res: Response, token: string): void {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env["NODE_ENV"] === "production",
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

export function clearTokenCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME, { path: "/" });
}

export function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!JWT_SECRET) {
    res.status(500).json({ error: "Server not configured" });
    return;
  }

  const token =
    req.cookies?.[COOKIE_NAME] ||
    req.headers.authorization?.replace("Bearer ", "");

  if (!token) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}
