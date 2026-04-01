import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { authMiddleware } from "../middleware/auth";
import { adminMiddleware, getAdminUser } from "../middleware/admin";
import { getDb, getAllDbKeys } from "../lib/mongo";
import type { AliasDoc, UserDoc, MailLogDoc } from "../lib/mongo";
import { logger } from "../lib/logger";
import { sendAdminLog } from "../lib/telegram";
import { sanitizeSearchQuery, isValidDbKey } from "../lib/sanitize";

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

router.get("/admin/dashboard", ...adminAuth, async (_req, res) => {
  try {
    const stats: Record<string, Record<string, Record<string, number>>> = {};

    const promises = getAllDbKeys().map(async (key) => {
      const db = getDb(key);
      if (!db) return;

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
    });

    await Promise.all(promises);
    res.json({ stats });
  } catch (err) {
    logger.error({ err }, "Dashboard error");
    res.status(500).json({ error: "Failed to load dashboard" });
  }
});

router.get("/admin/users", ...adminAuth, async (req, res) => {
  try {
    const status = String(req.query.status || "");
    const search = String(req.query.search || "");
    const page = String(req.query.page || "0");
    const limit = String(req.query.limit || "20");
    const p = Math.max(0, parseInt(page) || 0);
    const lim = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const allResults: Record<string, unknown>[] = [];
    let globalTotal = 0;

    const promises = getAllDbKeys().map(async (key) => {
      const db = getDb(key);
      if (!db) return;

      const filter: Record<string, unknown> = {};
      if (status && status !== "all") filter.status = status;
      if (search) {
        const safe = sanitizeSearchQuery(search);
        filter.$or = [
          { name: { $regex: safe, $options: "i" } },
          { username: { $regex: safe, $options: "i" } },
        ];
      }

      const [users, total] = await Promise.all([
        db.collection<UserDoc>("users").find(filter).sort({ created_at: -1 }).toArray(),
        db.collection<UserDoc>("users").countDocuments(filter),
      ]);

      globalTotal += total;
      if (users.length === 0) return;

      const tgIds = users.map((u) => u.tg_user_id);
      const aliasCounts = await db.collection<AliasDoc>("aliases").aggregate<{ _id: number; count: number }>([
        { $match: { tg_user_id: { $in: tgIds } } },
        { $group: { _id: "$tg_user_id", count: { $sum: 1 } } },
      ]).toArray();

      const countMap = new Map(aliasCounts.map((a) => [a._id, a.count]));

      for (const u of users) {
        allResults.push({
          ...u,
          aliasCount: countMap.get(u.tg_user_id) || 0,
          dbKey: key,
          dbLabel: key === "bot1" ? "Bot1" : "Bot2",
        });
      }
    });

    await Promise.all(promises);
    allResults.sort((a, b) => new Date(b.created_at as string).getTime() - new Date(a.created_at as string).getTime());
    const paginated = allResults.slice(p * lim, (p + 1) * lim);
    res.json({ users: paginated, total: globalTotal });
  } catch (err) {
    logger.error({ err }, "Admin users error");
    res.status(500).json({ error: "Failed to load users" });
  }
});

router.patch("/admin/users/:tgId/role", ...adminAuth, async (req, res) => {
  try {
    const { role, dbKey } = req.body as { role: string; dbKey: string };
    const tgUserId = parseInt(String(req.params.tgId));

    if (isNaN(tgUserId)) {
      res.status(400).json({ error: "Invalid user ID" });
      return;
    }

    if (!["user", "admin", "moderator"].includes(role)) {
      res.status(400).json({ error: "Invalid role" });
      return;
    }

    if (!isValidDbKey(dbKey)) {
      res.status(400).json({ error: "Invalid database" });
      return;
    }

    const db = getDb(dbKey);
    if (!db) {
      res.status(400).json({ error: "Database not available" });
      return;
    }

    const result = await db.collection("users").updateOne(
      { tg_user_id: tgUserId },
      { $set: { role, updated_at: new Date() } }
    );

    if (result.matchedCount === 0) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const admin = getAdminUser(req);
    await logAdminAction(dbKey, admin, "role_change", "user", String(tgUserId), `Changed role to ${role}`);

    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "Role change error");
    res.status(500).json({ error: "Failed to update role" });
  }
});

router.patch("/admin/users/:tgId/status", ...adminAuth, async (req, res) => {
  try {
    const { status, dbKey } = req.body as { status: string; dbKey: string };
    const tgUserId = parseInt(String(req.params.tgId));

    if (isNaN(tgUserId)) {
      res.status(400).json({ error: "Invalid user ID" });
      return;
    }

    if (!["active", "banned", "pending"].includes(status)) {
      res.status(400).json({ error: "Invalid status" });
      return;
    }

    if (!isValidDbKey(dbKey)) {
      res.status(400).json({ error: "Invalid database" });
      return;
    }

    const db = getDb(dbKey);
    if (!db) {
      res.status(400).json({ error: "Database not available" });
      return;
    }

    const result = await db.collection("users").updateOne(
      { tg_user_id: tgUserId },
      { $set: { status, updated_at: new Date() } }
    );

    if (result.matchedCount === 0) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const admin = getAdminUser(req);
    await logAdminAction(
      dbKey,
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
    const search = String(req.query.search || "");
    const active = String(req.query.active || "");
    const page = String(req.query.page || "0");
    const limit = String(req.query.limit || "20");
    const p = Math.max(0, parseInt(page) || 0);
    const lim = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const allResults: Record<string, unknown>[] = [];
    let globalTotal = 0;

    const promises = getAllDbKeys().map(async (key) => {
      const db = getDb(key);
      if (!db) return;

      const filter: Record<string, unknown> = {};
      if (active === "true") filter.active = true;
      if (active === "false") filter.active = false;
      if (search) {
        filter.alias_email = { $regex: sanitizeSearchQuery(search), $options: "i" };
      }

      const [aliases, total] = await Promise.all([
        db.collection<AliasDoc>("aliases").find(filter).sort({ created_at: -1 }).toArray(),
        db.collection<AliasDoc>("aliases").countDocuments(filter),
      ]);

      globalTotal += total;
      if (aliases.length === 0) return;

      const tgIds = [...new Set(aliases.map((a) => a.tg_user_id))];
      const users = await db.collection<UserDoc>("users").find({ tg_user_id: { $in: tgIds } }).toArray();
      const userMap = new Map(users.map((u) => [u.tg_user_id, u]));

      for (const a of aliases) {
        const user = userMap.get(a.tg_user_id);
        allResults.push({
          ...a,
          hasPassword: !!a.password,
          password: undefined,
          ownerName: user?.name || user?.username || String(a.tg_user_id),
          ownerStatus: user?.status || "unknown",
          dbKey: key,
          dbLabel: key === "bot1" ? "Bot1" : "Bot2",
        });
      }
    });

    await Promise.all(promises);
    allResults.sort((a, b) => new Date(b.created_at as string).getTime() - new Date(a.created_at as string).getTime());
    const paginated = allResults.slice(p * lim, (p + 1) * lim);
    res.json({ aliases: paginated, total: globalTotal });
  } catch (err) {
    logger.error({ err }, "Admin aliases error");
    res.status(500).json({ error: "Failed to load aliases" });
  }
});

router.patch("/admin/aliases/:email/status", ...adminAuth, async (req, res) => {
  try {
    const email = decodeURIComponent(String(req.params.email)).toLowerCase();
    const { active, dbKey } = req.body as { active: boolean; dbKey: string };

    if (!isValidDbKey(dbKey)) {
      res.status(400).json({ error: "Invalid database" });
      return;
    }

    if (typeof active !== "boolean") {
      res.status(400).json({ error: "active must be a boolean" });
      return;
    }

    const db = getDb(dbKey);
    if (!db) {
      res.status(400).json({ error: "Database not available" });
      return;
    }

    const result = await db.collection("aliases").updateOne(
      { alias_email: email },
      { $set: { active, updated_at: new Date() } }
    );

    if (result.matchedCount === 0) {
      res.status(404).json({ error: "Alias not found" });
      return;
    }

    const admin = getAdminUser(req);
    await logAdminAction(dbKey, admin, active ? "alias_activate" : "alias_deactivate", "alias", email, `Set active=${active}`);

    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "Alias status error");
    res.status(500).json({ error: "Failed to update alias" });
  }
});

router.patch("/admin/aliases/:email/extend", ...adminAuth, async (req, res) => {
  try {
    const email = decodeURIComponent(String(req.params.email)).toLowerCase();
    const { days, dbKey } = req.body as { days: number; dbKey: string };

    if (!isValidDbKey(dbKey)) {
      res.status(400).json({ error: "Invalid database" });
      return;
    }

    if (typeof days !== "number" || days < 1 || days > 365) {
      res.status(400).json({ error: "Days must be between 1 and 365" });
      return;
    }

    const db = getDb(dbKey);
    if (!db) {
      res.status(400).json({ error: "Database not available" });
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
    await logAdminAction(dbKey, admin, "alias_extend", "alias", email, `Extended by ${days} days until ${newExpiry.toISOString()}`);

    res.json({ success: true, newExpiry });
  } catch (err) {
    logger.error({ err }, "Alias extend error");
    res.status(500).json({ error: "Failed to extend alias" });
  }
});

router.post("/admin/aliases/:email/reset-password", ...adminAuth, async (req, res) => {
  try {
    const email = decodeURIComponent(String(req.params.email)).toLowerCase();
    const { dbKey } = req.body as { dbKey: string };

    if (!isValidDbKey(dbKey)) {
      res.status(400).json({ error: "Invalid database" });
      return;
    }

    const db = getDb(dbKey);
    if (!db) {
      res.status(400).json({ error: "Database not available" });
      return;
    }

    const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%";
    const bytes = crypto.randomBytes(12);
    const newPassword = Array.from(bytes).map((b) => alphabet[b % alphabet.length]).join("");
    const hashed = await bcrypt.hash(newPassword, 12);

    const result = await db.collection("aliases").updateOne(
      { alias_email: email },
      { $set: { password: hashed, updated_at: new Date() } }
    );

    if (result.matchedCount === 0) {
      res.status(404).json({ error: "Alias not found" });
      return;
    }

    const admin = getAdminUser(req);
    await logAdminAction(dbKey, admin, "password_reset", "alias", email, "Admin reset web password");

    res.json({ success: true, newPassword });
  } catch (err) {
    logger.error({ err }, "Password reset error");
    res.status(500).json({ error: "Failed to reset password" });
  }
});

router.post("/admin/aliases/bulk-set-passwords", ...adminAuth, async (req, res) => {
  try {
    const { dbKey } = req.body as { dbKey: string };

    if (!isValidDbKey(dbKey)) {
      res.status(400).json({ error: "Invalid database" });
      return;
    }

    const db = getDb(dbKey);
    if (!db) {
      res.status(400).json({ error: "Database not available" });
      return;
    }

    const aliasesWithoutPw = await db
      .collection<AliasDoc>("aliases")
      .find({
        $or: [{ password: { $exists: false } }, { password: null }, { password: "" }],
        active: true,
      })
      .toArray();

    if (aliasesWithoutPw.length === 0) {
      res.json({ success: true, updated: 0, passwords: [] });
      return;
    }

    const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%";
    const results: { email: string; password: string }[] = [];

    for (const alias of aliasesWithoutPw) {
      const bytes = crypto.randomBytes(10);
      const plain = Array.from(bytes).map((b) => alphabet[b % alphabet.length]).join("");
      const hashed = await bcrypt.hash(plain, 12);

      await db.collection("aliases").updateOne(
        { alias_email: alias.alias_email },
        { $set: { password: hashed, updated_at: new Date() } }
      );

      results.push({ email: alias.alias_email, password: plain });
    }

    const admin = getAdminUser(req);
    await logAdminAction(
      dbKey,
      admin,
      "bulk_set_passwords",
      "aliases",
      `${results.length} aliases`,
      `Set web passwords for ${results.length} aliases without passwords`
    );

    logger.info({ count: results.length, dbKey }, "Bulk password set complete");

    res.json({ success: true, updated: results.length, passwords: results });
  } catch (err) {
    logger.error({ err }, "Bulk set passwords error");
    res.status(500).json({ error: "Failed to set bulk passwords" });
  }
});

router.get("/admin/logs", ...adminAuth, async (req, res) => {
  try {
    const page = String(req.query.page || "0");
    const limit = String(req.query.limit || "50");
    const action = String(req.query.action || "");
    const search = String(req.query.search || "");
    const p = Math.max(0, parseInt(page) || 0);
    const lim = Math.min(200, Math.max(1, parseInt(limit) || 50));
    const allResults: AdminLogDoc[] = [];
    let globalTotal = 0;

    const promises = getAllDbKeys().map(async (key) => {
      const db = getDb(key);
      if (!db) return;

      const filter: Record<string, unknown> = {};
      if (action && action !== "all") filter.action = action;
      if (search) {
        const safe = sanitizeSearchQuery(search);
        filter.$or = [
          { targetId: { $regex: safe, $options: "i" } },
          { adminName: { $regex: safe, $options: "i" } },
          { details: { $regex: safe, $options: "i" } },
        ];
      }

      const [logs, total] = await Promise.all([
        db.collection<AdminLogDoc>("admin_logs").find(filter).sort({ timestamp: -1 }).toArray(),
        db.collection<AdminLogDoc>("admin_logs").countDocuments(filter),
      ]);

      globalTotal += total;
      allResults.push(...logs.map((l) => ({ ...l, dbKey: key })));
    });

    await Promise.all(promises);
    allResults.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    const paginated = allResults.slice(p * lim, (p + 1) * lim);
    res.json({ logs: paginated, total: globalTotal });
  } catch (err) {
    logger.error({ err }, "Admin logs error");
    res.status(500).json({ error: "Failed to load logs" });
  }
});

router.get("/admin/user/:tgId/details", ...adminAuth, async (req, res) => {
  try {
    const tgUserId = parseInt(String(req.params.tgId));
    const dbKey = String(req.query.dbKey || "");

    if (isNaN(tgUserId)) {
      res.status(400).json({ error: "Invalid user ID" });
      return;
    }

    if (!isValidDbKey(dbKey)) {
      res.status(400).json({ error: "Invalid database" });
      return;
    }

    const db = getDb(dbKey);
    if (!db) {
      res.status(400).json({ error: "Database not available" });
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
