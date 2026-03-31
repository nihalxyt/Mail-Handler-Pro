import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { findAliasByEmail, findAllAliasesByTgUser } from "../lib/mongo";
import {
  signToken,
  setTokenCookie,
  clearTokenCookie,
  authMiddleware,
} from "../middleware/auth";

const router: IRouter = Router();

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

    const result = await findAliasByEmail(email.trim());
    if (!result) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

    const { alias, dbKey } = result;

    if (!alias.password) {
      res.status(401).json({
        error: "No web password set. Use the Telegram bot to generate one.",
      });
      return;
    }

    const valid = await bcrypt.compare(password, alias.password);
    if (!valid) {
      res.status(401).json({ error: "Invalid email or password" });
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

    const token = signToken({
      aliasEmail: alias.alias_email,
      tgUserId: alias.tg_user_id,
      dbKey,
    });

    setTokenCookie(res, token);

    const allAliases = await findAllAliasesByTgUser(alias.tg_user_id);

    res.json({
      success: true,
      user: {
        email: alias.alias_email,
        tgUserId: alias.tg_user_id,
        aliases: allAliases.map((a) => ({
          email: a.alias.alias_email,
          active: a.alias.active,
          expiresAt: a.alias.expires_at,
          dbKey: a.dbKey,
          dbLabel: a.dbLabel,
        })),
      },
    });
  } catch (err) {
    console.error("Login error:", err);
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
      })),
    });
  } catch (err) {
    console.error("Me error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/auth/switch", authMiddleware, async (req, res) => {
  try {
    const { email } = req.body as { email?: string };
    if (!email) {
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

    const token = signToken({
      aliasEmail: result.alias.alias_email,
      tgUserId: result.alias.tg_user_id,
      dbKey: result.dbKey,
    });

    setTokenCookie(res, token);

    res.json({
      success: true,
      email: result.alias.alias_email,
      dbKey: result.dbKey,
    });
  } catch (err) {
    console.error("Switch error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
