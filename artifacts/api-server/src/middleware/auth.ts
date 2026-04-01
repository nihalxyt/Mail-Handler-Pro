import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { findAliasByEmail } from "../lib/mongo";
import { logger } from "../lib/logger";

const JWT_SECRET = process.env["JWT_SECRET"] || process.env["SESSION_SECRET"] || "";
const JWT_EXPIRY = "7d";
const COOKIE_NAME = "mail_token";
const CSRF_COOKIE = "csrf_token";

if (!JWT_SECRET) {
  console.error("FATAL: JWT_SECRET or SESSION_SECRET must be set");
}

export interface JwtPayload {
  aliasEmail: string;
  tgUserId: number;
  dbKey: "bot1" | "bot2";
  fp?: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export function generateFingerprint(req: Request): string {
  const ua = req.headers["user-agent"] || "";
  const accept = req.headers["accept-language"] || "";
  const raw = `${ua}|${accept}`;
  return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 16);
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
  res.clearCookie(CSRF_COOKIE, { path: "/" });
}

export function generateCsrfToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function setCsrfCookie(res: Response, token: string): void {
  res.cookie(CSRF_COOKIE, token, {
    httpOnly: false,
    secure: process.env["NODE_ENV"] === "production",
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

export function csrfMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    next();
    return;
  }

  const cookieToken = req.cookies?.[CSRF_COOKIE];
  const headerToken = req.headers["x-csrf-token"];

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    res.status(403).json({ error: "Invalid CSRF token" });
    return;
  }

  next();
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
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

    if (decoded.fp) {
      const currentFp = generateFingerprint(req);
      if (decoded.fp !== currentFp) {
        logger.warn(
          { email: decoded.aliasEmail, expected: decoded.fp, got: currentFp },
          "Fingerprint mismatch — possible session hijack"
        );
        clearTokenCookie(res);
        res.status(401).json({ error: "Session expired. Please log in again." });
        return;
      }
    }

    const result = await findAliasByEmail(decoded.aliasEmail);
    if (!result) {
      clearTokenCookie(res);
      res.status(401).json({ error: "Account no longer exists" });
      return;
    }

    if (result.alias.tg_user_id !== decoded.tgUserId || result.dbKey !== decoded.dbKey) {
      clearTokenCookie(res);
      res.status(401).json({ error: "Session invalid. Please log in again." });
      return;
    }

    if (!result.alias.active) {
      clearTokenCookie(res);
      res.status(403).json({ error: "This email alias has been deactivated" });
      return;
    }

    if (result.alias.expires_at && new Date(result.alias.expires_at) < new Date()) {
      clearTokenCookie(res);
      res.status(403).json({ error: "This email alias has expired" });
      return;
    }

    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}
