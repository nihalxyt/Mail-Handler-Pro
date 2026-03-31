import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { authMiddleware } from "../middleware/auth";
import { adminMiddleware, getAdminUser } from "../middleware/admin";
import { getDb, getAllDbKeys } from "../lib/mongo";
import type { AliasDoc, UserDoc, MailLogDoc } from "../lib/mongo";
import { logger } from "../lib/logger";
import { sendAdminLog } from "../lib/telegram";

const router: IRouter = Router();
const adminAuth = [authMiddleware, adminMiddleware];

interface AdminLogDoc {
  action: string;
  adminTgId: number;
  adminName: string;
  targetType: string;
  targetId: string;
  details: string;
  dbKey: string;
  timestamp: Date;
}

async function logAdminAction(
  dbKey: "bot1" | "bot2",
  admin: UserDoc,
  action: string,
  targetType: string,
  targetId: string,
  details: string
) {
  const db = getDb(dbKey);
  if (!db) return;

  const doc: AdminLogDoc = {
    action,
    adminTgId: admin.tg_user_id,
    adminName: admin.name || admin.username || String(admin.tg_user_id),
    targetType,
    targetId,
    details,
    dbKey,
    timestamp: new Date(),
  };

  try {
    await db.collection<AdminLogDoc>("admin_logs").insertOne(doc);
  } catch (err) {
    logger.error({ err }, "Failed to insert admin log");
  }

  await sendAdminLog(
    dbKey,
    doc.action,
    doc.adminName,
    doc.targetType,
    doc.targetId,
    doc.details
  );
}

router.get("/admin/check", ...adminAuth, (req, res) => {
  const admin = getAdminUser(req);
  res.json({
    isAdmin: true,
    role: admin.role,
    name: admin.name || admin.username,
  });
});

router.get("/admin/dashboard", ...adminAuth, async (req, res) => {
  try {
    const stats: Record<string, any> = {};

    for (const key of getAllDbKeys()) {
      const db = getDb(key);
      if (!db) continue;

      const [totalUsers, activeUsers, pendingUsers, bannedUsers, totalAliases, activeAliases, totalMails, unreadMails, recentMails] =
        await Promise.all([
          db.collection("users").countDocuments(),
          db.collection("users").countDocuments({ status: "active" }),
          db.collection("users").countDocuments({ status: "pending" }),
          db.collection("users").countDocuments({ status: "banned" }),
          db.collection("aliases").countDocuments(),
          db.collection("aliases").countDocuments({ active: true }),
          db.collection("mail_logs").countDocuments({ deleted: { $ne: true } }),
          db.collection("mail_logs").countDocuments({ read: false, deleted: { $ne: true } }),
          db.collection("mail_logs").countDocuments({
            received_at: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
          }),
        ]);

      stats[key] = {
        users: { total: totalUsers, active: activeUsers, pending: pendingUsers, banned: bannedUsers },
        aliases: { total: totalAliases, active: activeAliases },
        mails: { total: totalMails, unread: unreadMails, last24h: recentMails },
      };
    }

    res.json({ stats });
  } catch (err) {
    logger.error({ err }, "Dashboard error");
    res.status(500).json({ error: "Failed to load dashboard" });
  }
});

router.get("/admin/users", ...adminAuth, async (req, res) => {
  try {
    const { status, search, page = "0", limit = "20" } = req.query as Record<string, string>;
    const p = Math.max(0, parseInt(page) || 0);
    const lim = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const results: any[] = [];

    for (const key of getAllDbKeys()) {
      const db = getDb(key);
      if (!db) continue;

      const filter: Record<string, any> = {};
      if (status && status !== "all") filter.status = status;
      if (search) {
        filter.$or = [
          { name: { $regex: search, $options: "i" } },
          { username: { $regex: search, $options: "i" } },
          { _id: { $regex: search, $options: "i" } },
        ];
      }

      const [users, total] = await Promise.all([
        db.collection<UserDoc>("users").find(filter).sort({ created_at: -1 }).skip(p * lim).limit(lim).toArray(),
        db.collection<UserDoc>("users").countDocuments(filter),
      ]);

      const aliasCol = db.collection<AliasDoc>("aliases");
      for (const u of users) {
        const aliasCount = await aliasCol.countDocuments({ tg_user_id: u.tg_user_id });
        results.push({
          ...u,
          aliasCount,
          dbKey: key,
          dbLabel: key === "bot1" ? "Bot1" : "Bot2",
        });
      }
    }

    res.json({ users: results, total: results.length });
  } catch (err) {
    logger.error({ err }, "Admin users error");
    res.status(500).json({ error: "Failed to load users" });
  }
});

router.patch("/admin/users/:tgId/role", ...adminAuth, async (req, res) => {
  try {
    const { tgId } = req.params;
    const { role, dbKey } = req.body as { role: string; dbKey: string };
    const tgUserId = parseInt(tgId);

    if (!["user", "admin", "moderator"].includes(role)) {
      res.status(400).json({ error: "Invalid role" });
      return;
    }

    const db = getDb(dbKey as "bot1" | "bot2");
    if (!db) {
      res.status(400).json({ error: "Invalid database" });
      return;
    }

    await db.collection("users").updateOne(
      { tg_user_id: tgUserId },
      { $set: { role, updated_at: new Date() } }
    );

    const admin = getAdminUser(req);
    await logAdminAction(
      dbKey as "bot1" | "bot2",
      admin,
      "role_change",
      "user",
      String(tgUserId),
      `Changed role to ${role}`
    );

    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "Role change error");
    res.status(500).json({ error: "Failed to update role" });
  }
});

router.patch("/admin/users/:tgId/status", ...adminAuth, async (req, res) => {
  try {
    const { tgId } = req.params;
    const { status, dbKey } = req.body as { status: string; dbKey: string };
    const tgUserId = parseInt(tgId);

    if (!["active", "banned", "pending"].includes(status)) {
      res.status(400).json({ error: "Invalid status" });
      return;
    }

    const db = getDb(dbKey as "bot1" | "bot2");
    if (!db) {
      res.status(400).json({ error: "Invalid database" });
      return;
    }

    await db.collection("users").updateOne(
      { tg_user_id: tgUserId },
      { $set: { status, updated_at: new Date() } }
    );

    const admin = getAdminUser(req);
    await logAdminAction(
      dbKey as "bot1" | "bot2",
      admin,
      status === "banned" ? "user_ban" : status === "active" ? "user_approve" : "user_pending",
      "user",
      String(tgUserId),
      `Set status to ${status}`
    );

    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "Status change error");
    res.status(500).json({ error: "Failed to update status" });
  }
});

router.get("/admin/aliases", ...adminAuth, async (req, res) => {
  try {
    const { search, active, page = "0", limit = "20" } = req.query as Record<string, string>;
    const p = Math.max(0, parseInt(page) || 0);
    const lim = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const results: any[] = [];

    for (const key of getAllDbKeys()) {
      const db = getDb(key);
      if (!db) continue;

      const filter: Record<string, any> = {};
      if (active === "true") filter.active = true;
      if (active === "false") filter.active = false;
      if (search) {
        filter.alias_email = { $regex: search, $options: "i" };
      }

      const aliases = await db
        .collection<AliasDoc>("aliases")
        .find(filter)
        .sort({ created_at: -1 })
        .skip(p * lim)
        .limit(lim)
        .toArray();

      for (const a of aliases) {
        const user = await db.collection<UserDoc>("users").findOne({ tg_user_id: a.tg_user_id });
        results.push({
          ...a,
          hasPassword: !!a.password,
          ownerName: user?.name || user?.username || String(a.tg_user_id),
          ownerStatus: user?.status || "unknown",
          dbKey: key,
          dbLabel: key === "bot1" ? "Bot1" : "Bot2",
        });
      }
    }

    res.json({ aliases: results, total: results.length });
  } catch (err) {
    logger.error({ err }, "Admin aliases error");
    res.status(500).json({ error: "Failed to load aliases" });
  }
});

router.patch("/admin/aliases/:email/status", ...adminAuth, async (req, res) => {
  try {
    const email = decodeURIComponent(req.params.email).toLowerCase();
    const { active, dbKey } = req.body as { active: boolean; dbKey: string };

    const db = getDb(dbKey as "bot1" | "bot2");
    if (!db) {
      res.status(400).json({ error: "Invalid database" });
      return;
    }

    await db.collection("aliases").updateOne(
      { alias_email: email },
      { $set: { active, updated_at: new Date() } }
    );

    const admin = getAdminUser(req);
    await logAdminAction(
      dbKey as "bot1" | "bot2",
      admin,
      active ? "alias_activate" : "alias_deactivate",
      "alias",
      email,
      `Set active=${active}`
    );

    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "Alias status error");
    res.status(500).json({ error: "Failed to update alias" });
  }
});

router.patch("/admin/aliases/:email/extend", ...adminAuth, async (req, res) => {
  try {
    const email = decodeURIComponent(req.params.email).toLowerCase();
    const { days, dbKey } = req.body as { days: number; dbKey: string };

    const db = getDb(dbKey as "bot1" | "bot2");
    if (!db) {
      res.status(400).json({ error: "Invalid database" });
      return;
    }

    const alias = await db.collection<AliasDoc>("aliases").findOne({ alias_email: email });
    if (!alias) {
      res.status(404).json({ error: "Alias not found" });
      return;
    }

    const currentExpiry = alias.expires_at ? new Date(alias.expires_at) : new Date();
    const base = currentExpiry > new Date() ? currentExpiry : new Date();
    const newExpiry = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);

    await db.collection("aliases").updateOne(
      { alias_email: email },
      { $set: { expires_at: newExpiry, active: true, updated_at: new Date() } }
    );

    const admin = getAdminUser(req);
    await logAdminAction(
      dbKey as "bot1" | "bot2",
      admin,
      "alias_extend",
      "alias",
      email,
      `Extended by ${days} days until ${newExpiry.toISOString()}`
    );

    res.json({ success: true, newExpiry });
  } catch (err) {
    logger.error({ err }, "Alias extend error");
    res.status(500).json({ error: "Failed to extend alias" });
  }
});

router.post("/admin/aliases/:email/reset-password", ...adminAuth, async (req, res) => {
  try {
    const email = decodeURIComponent(req.params.email).toLowerCase();
    const { dbKey } = req.body as { dbKey: string };

    const db = getDb(dbKey as "bot1" | "bot2");
    if (!db) {
      res.status(400).json({ error: "Invalid database" });
      return;
    }

    const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%";
    const bytes = crypto.randomBytes(12);
    const newPassword = Array.from(bytes).map((b) => alphabet[b % alphabet.length]).join("");
    const hashed = await bcrypt.hash(newPassword, 12);

    await db.collection("aliases").updateOne(
      { alias_email: email },
      { $set: { password: hashed, updated_at: new Date() } }
    );

    const admin = getAdminUser(req);
    await logAdminAction(
      dbKey as "bot1" | "bot2",
      admin,
      "password_reset",
      "alias",
      email,
      "Admin reset web password"
    );

    res.json({ success: true, newPassword });
  } catch (err) {
    logger.error({ err }, "Password reset error");
    res.status(500).json({ error: "Failed to reset password" });
  }
});

router.get("/admin/logs", ...adminAuth, async (req, res) => {
  try {
    const { page = "0", limit = "50", action, search } = req.query as Record<string, string>;
    const p = Math.max(0, parseInt(page) || 0);
    const lim = Math.min(200, Math.max(1, parseInt(limit) || 50));
    const results: AdminLogDoc[] = [];

    for (const key of getAllDbKeys()) {
      const db = getDb(key);
      if (!db) continue;

      const filter: Record<string, any> = {};
      if (action && action !== "all") filter.action = action;
      if (search) {
        filter.$or = [
          { targetId: { $regex: search, $options: "i" } },
          { adminName: { $regex: search, $options: "i" } },
          { details: { $regex: search, $options: "i" } },
        ];
      }

      const logs = await db
        .collection<AdminLogDoc>("admin_logs")
        .find(filter)
        .sort({ timestamp: -1 })
        .skip(p * lim)
        .limit(lim)
        .toArray();

      results.push(...logs.map((l) => ({ ...l, dbKey: key })));
    }

    results.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    res.json({ logs: results.slice(0, lim), total: results.length });
  } catch (err) {
    logger.error({ err }, "Admin logs error");
    res.status(500).json({ error: "Failed to load logs" });
  }
});

router.get("/admin/user/:tgId/details", ...adminAuth, async (req, res) => {
  try {
    const tgUserId = parseInt(req.params.tgId);
    const { dbKey } = req.query as { dbKey: string };

    const db = getDb(dbKey as "bot1" | "bot2");
    if (!db) {
      res.status(400).json({ error: "Invalid database" });
      return;
    }

    const [user, aliases, mailCount, recentMails] = await Promise.all([
      db.collection<UserDoc>("users").findOne({ tg_user_id: tgUserId }),
      db.collection<AliasDoc>("aliases").find({ tg_user_id: tgUserId }).toArray(),
      db.collection("mail_logs").countDocuments({ tg_user_id: tgUserId, deleted: { $ne: true } }),
      db.collection<MailLogDoc>("mail_logs")
        .find({ tg_user_id: tgUserId, deleted: { $ne: true } })
        .sort({ received_at: -1 })
        .limit(10)
        .toArray(),
    ]);

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    res.json({
      user,
      aliases: aliases.map((a) => ({
        ...a,
        hasPassword: !!a.password,
        password: undefined,
      })),
      mailCount,
      recentMails: recentMails.map((m) => ({
        id: m._id,
        from: m.from,
        subject: m.subject,
        receivedAt: m.received_at,
        read: m.read,
        aliasEmail: m.alias_email,
      })),
    });
  } catch (err) {
    logger.error({ err }, "User details error");
    res.status(500).json({ error: "Failed to load user details" });
  }
});

export default router;
