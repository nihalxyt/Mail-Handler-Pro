import { Router, type IRouter } from "express";
import crypto from "node:crypto";
import { getDb, getAllDbKeys } from "../lib/mongo";
import type { AliasDoc, MailLogDoc, UserDoc } from "../lib/mongo";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const INCOMING_API_KEY =
  process.env["INCOMING_MAIL_API_KEY"] || process.env["SESSION_SECRET"] || "";

function apiKeyAuth(
  req: import("express").Request,
  res: import("express").Response,
  next: import("express").NextFunction
): void {
  const key =
    req.headers["x-api-key"] || req.query.apiKey;
  if (!INCOMING_API_KEY || !key || key !== INCOMING_API_KEY) {
    res.status(403).json({ error: "Invalid API key" });
    return;
  }
  next();
}

interface IncomingMailBody {
  to: string;
  from: string;
  subject: string;
  body: string;
  rawHeaders?: Record<string, string>;
  messageId?: string;
  date?: string;
}

router.post("/incoming-mail", apiKeyAuth, async (req, res) => {
  try {
    const {
      to,
      from: sender,
      subject,
      body,
      messageId,
      date: dateHeader,
    } = req.body as IncomingMailBody;

    if (!to) {
      res.status(400).json({ error: "Missing 'to' field" });
      return;
    }

    const toAddr = to.toLowerCase().trim();
    const allKeys = getAllDbKeys();
    let matched = false;

    for (const key of allKeys) {
      const db = getDb(key);
      if (!db) continue;
      const aliasCol = db.collection<AliasDoc>("aliases");
      const alias = await aliasCol.findOne({ alias_email: toAddr });
      if (!alias) continue;

      if (
        !alias.active ||
        (alias.expires_at && new Date(alias.expires_at) < new Date())
      ) {
        logger.info({ to: toAddr, reason: "inactive_or_expired" }, "Alias not deliverable");
        continue;
      }

      const userCol = db.collection<UserDoc>("users");
      const user = await userCol.findOne({ tg_user_id: alias.tg_user_id });
      if (!user || user.status !== "active") {
        logger.info({ to: toAddr, reason: "user_inactive" }, "User not active");
        continue;
      }

      const dedupeInput = `${messageId || ""}|${toAddr}|${subject || ""}|${sender || ""}`;
      const dedupeKey = crypto
        .createHash("sha256")
        .update(dedupeInput)
        .digest("hex");

      const snippet =
        (body || "").replace(/<[^>]+>/g, "").substring(0, 220).trim() || "";

      const logDoc: MailLogDoc = {
        _id: dedupeKey,
        dedupe_key: dedupeKey,
        alias_email: toAddr,
        original_to: toAddr,
        tg_user_id: alias.tg_user_id,
        from: sender || "",
        subject: subject || "(No Subject)",
        date_header: dateHeader || new Date().toISOString(),
        received_at: new Date(),
        snippet,
        body: body || "",
        read: false,
        deleted: false,
        starred: false,
        bot: key === "bot1" ? "Bot1" : "Bot2",
      };

      const logCol = db.collection<MailLogDoc>("mail_logs");
      try {
        await logCol.insertOne(logDoc as any);
      } catch (err: any) {
        if (err?.code === 11000) {
          res.json({ success: true, duplicate: true });
          return;
        }
        throw err;
      }

      matched = true;
      logger.info({ to: toAddr, dedupeKey }, "Email stored via API");
      break;
    }

    if (!matched) {
      const firstKey = allKeys[0];
      const db = firstKey ? getDb(firstKey) : null;
      if (db) {
        const dedupeInput = `${messageId || ""}|${toAddr}|${subject || ""}|${sender || ""}|fallback`;
        const dedupeKey = crypto
          .createHash("sha256")
          .update(dedupeInput)
          .digest("hex");

        const logDoc = {
          _id: dedupeKey,
          dedupe_key: dedupeKey,
          alias_email: toAddr,
          original_to: toAddr,
          tg_user_id: 0,
          from: sender || "",
          subject: subject || "(No Subject)",
          date_header: dateHeader || new Date().toISOString(),
          received_at: new Date(),
          snippet:
            (body || "").replace(/<[^>]+>/g, "").substring(0, 220).trim() || "",
          body: body || "",
          read: false,
          deleted: false,
          starred: false,
          bot: "Bot1",
          admin_fallback: true,
          fallback_reason: "unassigned",
        };

        try {
          await db.collection("mail_logs").insertOne(logDoc);
        } catch (err: any) {
          if (err?.code !== 11000) throw err;
        }
      }

      logger.warn({ to: toAddr }, "No alias found — fallback stored");
    }

    res.json({ success: true, matched });
  } catch (err) {
    logger.error({ err }, "Incoming mail error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
