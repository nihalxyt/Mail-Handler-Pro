import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { authMiddleware } from "../middleware/auth";
import { findAllAliasesByTgUser, getDb, getAllDbKeys } from "../lib/mongo";
import type { AliasDoc } from "../lib/mongo";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.get("/aliases", authMiddleware, async (req, res) => {
  try {
    const user = req.user!;
    const allAliases = await findAllAliasesByTgUser(user.tgUserId);

    res.json({
      aliases: allAliases.map((a) => ({
        email: a.alias.alias_email,
        active: a.alias.active,
        expiresAt: a.alias.expires_at,
        hasPassword: !!a.alias.password,
        dbKey: a.dbKey,
        dbLabel: a.dbLabel,
        createdAt: a.alias.created_at,
      })),
    });
  } catch (err) {
    logger.error({ err }, "Aliases error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/aliases/:email/password", authMiddleware, async (req, res) => {
  try {
    const user = req.user!;
    const targetEmail = decodeURIComponent(String(req.params.email)).toLowerCase();
    const { currentPassword, newPassword } = req.body as {
      currentPassword?: string;
      newPassword?: string;
    };

    if (!newPassword || typeof newPassword !== "string" || newPassword.length < 6) {
      res.status(400).json({ error: "New password must be at least 6 characters" });
      return;
    }

    if (newPassword.length > 128) {
      res.status(400).json({ error: "Password too long" });
      return;
    }

    for (const key of getAllDbKeys()) {
      const db = getDb(key);
      if (!db) continue;
      const col = db.collection<AliasDoc>("aliases");
      const alias = await col.findOne({
        alias_email: targetEmail,
        tg_user_id: user.tgUserId,
      });

      if (alias) {
        if (alias.password) {
          if (!currentPassword) {
            res.status(400).json({ error: "Current password is required" });
            return;
          }
          const valid = await bcrypt.compare(currentPassword, alias.password);
          if (!valid) {
            res.status(401).json({ error: "Current password is incorrect" });
            return;
          }
        }

        const hash = await bcrypt.hash(newPassword, 12);
        await col.updateOne(
          { alias_email: targetEmail },
          { $set: { password: hash, updated_at: new Date() } }
        );

        logger.info({ alias: targetEmail }, "Password changed");
        res.json({ success: true });
        return;
      }
    }

    res.status(404).json({ error: "Alias not found or not yours" });
  } catch (err) {
    logger.error({ err }, "Password change error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
