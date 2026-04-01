import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { findAliasByEmail, findAllAliasesByTgUser, getDb, getAllDbKeys } from "../lib/mongo";
import {
  signToken,
  setTokenCookie,
  clearTokenCookie,
  authMiddleware,
  generateFingerprint,
  generateCsrfToken,
  setCsrfCookie,
} from "../middleware/auth";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const INCOMING_API_KEY =
  process.env["INCOMING_MAIL_API_KEY"] || process.env["SESSION_SECRET"] || "";

function botApiKeyAuth(
  req: import("express").Request,
  res: import("express").Response,
  next: import("express").NextFunction
): void {
  const key = req.headers["x-api-key"];
  if (!INCOMING_API_KEY || !key || key !== INCOMING_API_KEY) {
    res.status(403).json({ error: "Invalid API key" });
    return;
  }
  next();
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

router.post("/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body as {
      email?: string;
      password?: string;
    };

    if (!email || !password) {
      res.status(400).json({ error: "Email and password are required" });
      return;
    }

    if (typeof email !== "string" || typeof password !== "string") {
      res.status(400).json({ error: "Invalid input" });
      return;
    }

    if (email.length > 320 || password.length > 128) {
      res.status(400).json({ error: "Invalid input length" });
      return;
    }

    const result = await findAliasByEmail(email.trim());
    if (!result) {
      res.status(401).json({ error: "No account found with this email", code: "EMAIL_NOT_FOUND" });
      return;
    }

    const { alias, dbKey } = result;

    if (!alias.password) {
      res.status(401).json({
        error: "No web password set. Use the Telegram bot to generate one.",
        code: "NO_PASSWORD",
      });
      return;
    }

    const valid = await bcrypt.compare(password, alias.password);
    if (!valid) {
      res.status(401).json({ error: "Incorrect password. Please try again.", code: "WRONG_PASSWORD" });
      return;
    }

    if (!alias.active) {
      res.status(403).json({ error: "This email alias is deactivated" });
      return;
    }

    const now = new Date();
    if (alias.expires_at && new Date(alias.expires_at) < now) {
      res.status(403).json({ error: "This email alias has expired" });
      return;
    }

    const fp = generateFingerprint(req);

    const token = signToken({
      aliasEmail: alias.alias_email,
      tgUserId: alias.tg_user_id,
      dbKey,
      fp,
    });

    setTokenCookie(res, token);

    const csrfToken = generateCsrfToken();
    setCsrfCookie(res, csrfToken);

    const allAliases = await findAllAliasesByTgUser(alias.tg_user_id);

    const db = (await import("../lib/mongo")).getDb(dbKey);
    let role = "user";
    if (db) {
      const userDoc = await db.collection("users").findOne({ tg_user_id: alias.tg_user_id });
      if (userDoc) role = userDoc.role || "user";
    }

    const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown";
    const ua = req.headers["user-agent"] || "unknown";
    logger.info({ email: alias.alias_email, ip, ua: ua.slice(0, 80) }, "User logged in");

    res.json({
      success: true,
      user: {
        email: alias.alias_email,
        tgUserId: alias.tg_user_id,
        dbKey,
        role,
        aliases: allAliases.map((a) => ({
          email: a.alias.alias_email,
          active: a.alias.active,
          expiresAt: a.alias.expires_at,
          dbKey: a.dbKey,
          dbLabel: a.dbLabel,
          hasPassword: !!a.alias.password,
        })),
      },
    });
  } catch (err) {
    logger.error({ err }, "Login error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/auth/admin-login", async (req, res) => {
  try {
    const { email, password, adminKey } = req.body as {
      email?: string;
      password?: string;
      adminKey?: string;
    };

    if (!email || !password) {
      res.status(400).json({ error: "Email and password are required" });
      return;
    }

    if (typeof email !== "string" || typeof password !== "string") {
      res.status(400).json({ error: "Invalid input" });
      return;
    }

    const envAdminKey = process.env["ADMIN_SECRET_KEY"] || "";
    if (envAdminKey && (!adminKey || adminKey !== envAdminKey)) {
      res.status(403).json({ error: "Invalid admin access key" });
      return;
    }

    const result = await findAliasByEmail(email.trim());
    if (!result) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    const { alias, dbKey } = result;

    if (!alias.password) {
      res.status(401).json({ error: "No web password set" });
      return;
    }

    const valid = await bcrypt.compare(password, alias.password);
    if (!valid) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    if (!alias.active) {
      res.status(403).json({ error: "This email alias is deactivated" });
      return;
    }

    const now = new Date();
    if (alias.expires_at && new Date(alias.expires_at) < now) {
      res.status(403).json({ error: "This email alias has expired" });
      return;
    }

    const { getDb } = await import("../lib/mongo");
    const db = getDb(dbKey);
    if (!db) {
      res.status(500).json({ error: "Database not available" });
      return;
    }

    const userDoc = await db.collection("users").findOne({ tg_user_id: alias.tg_user_id });
    const role = userDoc?.role || "user";
    const ADMIN_ROLES = ["admin", "moderator", "super_admin"];

    if (!ADMIN_ROLES.includes(role)) {
      res.status(403).json({ error: "Admin access required. You are not authorized." });
      return;
    }

    const fp = generateFingerprint(req);
    const token = signToken({
      aliasEmail: alias.alias_email,
      tgUserId: alias.tg_user_id,
      dbKey,
      fp,
    });

    setTokenCookie(res, token);
    const csrfToken = generateCsrfToken();
    setCsrfCookie(res, csrfToken);

    const allAliases = await findAllAliasesByTgUser(alias.tg_user_id);
    const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown";
    const ua = req.headers["user-agent"] || "unknown";
    logger.info({ email: alias.alias_email, ip, ua: ua.slice(0, 80), role }, "Admin logged in");

    res.json({
      success: true,
      user: {
        email: alias.alias_email,
        tgUserId: alias.tg_user_id,
        dbKey,
        role,
        aliases: allAliases.map((a) => ({
          email: a.alias.alias_email,
          active: a.alias.active,
          expiresAt: a.alias.expires_at,
          dbKey: a.dbKey,
          dbLabel: a.dbLabel,
          hasPassword: !!a.alias.password,
        })),
      },
    });
  } catch (err) {
    logger.error({ err }, "Admin login error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/auth/logout", (_req, res) => {
  clearTokenCookie(res);
  res.json({ success: true });
});

router.get("/auth/me", authMiddleware, async (req, res) => {
  try {
    const user = req.user!;
    const allAliases = await findAllAliasesByTgUser(user.tgUserId);

    const db = (await import("../lib/mongo")).getDb(user.dbKey);
    let role = "user";
    if (db) {
      const userDoc = await db.collection("users").findOne({ tg_user_id: user.tgUserId });
      if (userDoc) role = userDoc.role || "user";
    }

    const csrfToken = generateCsrfToken();
    setCsrfCookie(res, csrfToken);

    res.json({
      email: user.aliasEmail,
      tgUserId: user.tgUserId,
      dbKey: user.dbKey,
      role,
      aliases: allAliases.map((a) => ({
        email: a.alias.alias_email,
        active: a.alias.active,
        expiresAt: a.alias.expires_at,
        dbKey: a.dbKey,
        dbLabel: a.dbLabel,
        hasPassword: !!a.alias.password,
      })),
    });
  } catch (err) {
    logger.error({ err }, "Me error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/auth/switch", authMiddleware, async (req, res) => {
  try {
    const { email } = req.body as { email?: string };
    if (!email || typeof email !== "string") {
      res.status(400).json({ error: "Email is required" });
      return;
    }

    const result = await findAliasByEmail(email.trim());
    if (!result) {
      res.status(404).json({ error: "Alias not found" });
      return;
    }

    if (result.alias.tg_user_id !== req.user!.tgUserId) {
      res.status(403).json({ error: "Not your alias" });
      return;
    }

    if (!result.alias.active) {
      res.status(403).json({ error: "This email alias is deactivated" });
      return;
    }

    const now = new Date();
    if (result.alias.expires_at && new Date(result.alias.expires_at) < now) {
      res.status(403).json({ error: "This email alias has expired" });
      return;
    }

    const fp = generateFingerprint(req);

    const token = signToken({
      aliasEmail: result.alias.alias_email,
      tgUserId: result.alias.tg_user_id,
      dbKey: result.dbKey,
      fp,
    });

    setTokenCookie(res, token);

    logger.info({ from: req.user!.aliasEmail, to: result.alias.alias_email }, "Account switched");

    res.json({
      success: true,
      email: result.alias.alias_email,
      dbKey: result.dbKey,
    });
  } catch (err) {
    logger.error({ err }, "Switch error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/auth/create-access-token", botApiKeyAuth, async (req, res) => {
  try {
    const { email, type } = req.body as {
      email?: string;
      type?: "user" | "admin";
    };

    if (!email || typeof email !== "string") {
      res.status(400).json({ error: "Email is required" });
      return;
    }

    const tokenType = type === "admin" ? "admin" : "user";

    const result = await findAliasByEmail(email.trim());
    if (!result) {
      res.status(404).json({ error: "Alias not found" });
      return;
    }

    const { alias, dbKey } = result;

    if (!alias.active) {
      res.status(403).json({ error: "Alias is deactivated" });
      return;
    }

    if (alias.expires_at && new Date(alias.expires_at) < new Date()) {
      res.status(403).json({ error: "Alias has expired" });
      return;
    }

    if (tokenType === "admin") {
      const db = getDb(dbKey);
      if (!db) {
        res.status(500).json({ error: "Database not available" });
        return;
      }
      const userDoc = await db.collection("users").findOne({ tg_user_id: alias.tg_user_id });
      const role = userDoc?.role || "user";
      if (!["admin", "moderator", "super_admin"].includes(role)) {
        res.status(403).json({ error: "User is not an admin" });
        return;
      }
    }

    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = hashToken(rawToken);

    const db = getDb(dbKey);
    if (!db) {
      res.status(500).json({ error: "Database not available" });
      return;
    }

    await db.collection("login_tokens").deleteMany({
      alias_email: alias.alias_email,
      type: tokenType,
    });

    await db.collection("login_tokens").insertOne({
      _id: tokenHash,
      token_hash: tokenHash,
      alias_email: alias.alias_email,
      tg_user_id: alias.tg_user_id,
      dbKey,
      type: tokenType,
      created_at: new Date(),
      expires_at: new Date(Date.now() + 5 * 60 * 1000),
      used: false,
    });

    logger.info({ email: alias.alias_email, type: tokenType }, "Access token created");

    res.json({
      success: true,
      token: rawToken,
      expiresIn: 300,
    });
  } catch (err) {
    logger.error({ err }, "Create access token error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/auth/token-login", async (req, res) => {
  try {
    const { token } = req.body as { token?: string };

    if (!token || typeof token !== "string" || token.length !== 64) {
      res.status(400).json({ error: "Invalid token" });
      return;
    }

    const tokenHash = hashToken(token);
    const now = new Date();

    let tokenDoc: Record<string, unknown> | null = null;
    let foundDbKey: "bot1" | "bot2" | null = null;

    for (const key of getAllDbKeys()) {
      const db = getDb(key);
      if (!db) continue;
      const doc = await db.collection("login_tokens").findOneAndUpdate(
        {
          _id: tokenHash,
          used: false,
          expires_at: { $gt: now },
        },
        { $set: { used: true, used_at: now } },
        { returnDocument: "before" }
      );
      if (doc) {
        tokenDoc = doc as Record<string, unknown>;
        foundDbKey = key;
        break;
      }
    }

    if (!tokenDoc || !foundDbKey) {
      res.status(401).json({ error: "Invalid, expired, or already used login link. Request a new one from the bot." });
      return;
    }

    const aliasEmail = tokenDoc.alias_email as string;
    const aliasResult = await findAliasByEmail(aliasEmail);
    if (!aliasResult) {
      res.status(401).json({ error: "Account no longer exists" });
      return;
    }

    const { alias, dbKey } = aliasResult;

    if (!alias.active) {
      res.status(403).json({ error: "This email alias is deactivated" });
      return;
    }

    if (alias.expires_at && new Date(alias.expires_at) < now) {
      res.status(403).json({ error: "This email alias has expired" });
      return;
    }

    const tokenType = tokenDoc.type as string;
    const isAdminToken = tokenType === "admin";

    const userDb = getDb(dbKey);
    let role = "user";
    if (userDb) {
      const userDoc = await userDb.collection("users").findOne({ tg_user_id: alias.tg_user_id });
      if (userDoc) role = (userDoc.role as string) || "user";
    }

    if (isAdminToken && !["admin", "moderator", "super_admin"].includes(role)) {
      res.status(403).json({ error: "Admin access required" });
      return;
    }

    const fp = generateFingerprint(req);
    const jwtToken = signToken({
      aliasEmail: alias.alias_email,
      tgUserId: alias.tg_user_id,
      dbKey,
      fp,
    });

    setTokenCookie(res, jwtToken);
    const csrfToken = generateCsrfToken();
    setCsrfCookie(res, csrfToken);

    const allAliases = await findAllAliasesByTgUser(alias.tg_user_id);

    const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown";
    const ua = req.headers["user-agent"] || "unknown";
    logger.info(
      { email: alias.alias_email, ip, ua: ua.slice(0, 80), type: tokenType },
      "Token login successful"
    );

    res.json({
      success: true,
      type: tokenType,
      user: {
        email: alias.alias_email,
        tgUserId: alias.tg_user_id,
        dbKey,
        role,
        aliases: allAliases.map((a) => ({
          email: a.alias.alias_email,
          active: a.alias.active,
          expiresAt: a.alias.expires_at,
          dbKey: a.dbKey,
          dbLabel: a.dbLabel,
          hasPassword: !!a.alias.password,
        })),
      },
    });
  } catch (err) {
    logger.error({ err }, "Token login error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
