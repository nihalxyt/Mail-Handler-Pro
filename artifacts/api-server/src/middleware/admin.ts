import type { Request, Response, NextFunction } from "express";
import { getDb } from "../lib/mongo";
import type { UserDoc } from "../lib/mongo";

const ADMIN_ROLES = ["admin", "moderator", "super_admin"];

export async function adminMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const db = getDb(req.user.dbKey);
  if (!db) {
    res.status(500).json({ error: "Database not available" });
    return;
  }

  const user = await db
    .collection<UserDoc>("users")
    .findOne({ tg_user_id: req.user.tgUserId });

  if (!user || !ADMIN_ROLES.includes(user.role)) {
    res.status(403).json({ error: "Admin access required" });
    return;
  }

  (req as any).adminUser = user;
  (req as any).adminRole = user.role;
  next();
}

export function getAdminUser(req: Request): UserDoc {
  return (req as any).adminUser;
}

export function isAdmin(req: Request): boolean {
  return !!(req as any).adminRole;
}
