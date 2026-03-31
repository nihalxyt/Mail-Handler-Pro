import { Router, type IRouter } from "express";
import crypto from "node:crypto";
import { getDb, getAllDbKeys } from "../lib/mongo";
import type { AliasDoc, MailLogDoc, UserDoc } from "../lib/mongo";
import { logger } from "../lib/logger";
import { notifyUserNewMail, notifyAdminFallback } from "../lib/telegram";
import type { OptionalId } from "mongodb";

const router: IRouter = Router();

const INCOMING_API_KEY =
  process.env["INCOMING_MAIL_API_KEY"] || process.env["SESSION_SECRET"] || "";

function apiKeyAuth(
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

interface IncomingMailBody {
  to: string;
  from: string;
  subject: string;
  body: string;
  rawHeaders?: Record<string, string>;
  messageId?: string;
  date?: string;
}

function makeDedupeKey(
  messageId: string,
  toAddr: string,
  subject: string,
  sender: string,
  suffix?: string
): string {
  const input = suffix
    ? `${messageId}|${toAddr}|${subject}|${sender}|${suffix}`
    : `${messageId}|${toAddr}|${subject}|${sender}`;
  return crypto.createHash("sha256").update(input).digest("hex");
}

function makeSnippet(body: string): string {
  return (body || "").replace(/<[^>]+>/g, "").substring(0, 220).trim() || "";
}

async function deliverEmail(
  dbKey: "bot1" | "bot2",
  alias: AliasDoc,
  sender: string,
  subject: string,
  body: string,
  messageId: string,
  dateHeader: string,
  toAddr: string
): Promise<{ stored: boolean; duplicate: boolean }> {
  const db = getDb(dbKey);
  if (!db) return { stored: false, duplicate: false };

  const userCol = db.collection<UserDoc>("users");
  const user = await userCol.findOne({ tg_user_id: alias.tg_user_id });

  const dedupeKey = makeDedupeKey(messageId, toAddr, subject, sender);
  const snippet = makeSnippet(body);
  const botLabel = dbKey === "bot1" ? "Bot1" : "Bot2";

  if (!user || user.status !== "active") {
    const fallbackDedupeKey = makeDedupeKey(
      messageId,
      toAddr,
      subject,
      sender,
      `user_inactive_fallback`
    );
    const fallbackDoc: OptionalId<MailLogDoc> = {
      _id: fallbackDedupeKey,
      dedupe_key: fallbackDedupeKey,
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
      bot: botLabel,
      admin_fallback: true,
      fallback_reason: "user_inactive",
    };

    try {
      await db.collection<MailLogDoc>("mail_logs").insertOne(fallbackDoc);
    } catch (err: unknown) {
      const mongoErr = err as { code?: number };
      if (mongoErr?.code === 11000) return { stored: true, duplicate: true };
      throw err;
    }

    await notifyAdminFallback(
      dbKey,
      "user_inactive",
      sender || "",
      subject || "(No Subject)",
      snippet,
      toAddr
    );

    logger.info({ to: toAddr, reason: "user_inactive" }, "User not active — stored as admin fallback");
    return { stored: true, duplicate: false };
  }

  const logDoc: OptionalId<MailLogDoc> = {
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
    bot: botLabel,
  };

  try {
    await db.collection<MailLogDoc>("mail_logs").insertOne(logDoc);
  } catch (err: unknown) {
    const mongoErr = err as { code?: number };
    if (mongoErr?.code === 11000) return { stored: true, duplicate: true };
    throw err;
  }

  await userCol.updateOne(
    { tg_user_id: alias.tg_user_id },
    { $inc: { "stats.total_mails": 1 } }
  );

  const shouldNotify = user.notifications !== false;
  if (shouldNotify) {
    await notifyUserNewMail(
      dbKey,
      alias.tg_user_id,
      sender || "",
      subject || "(No Subject)",
      snippet,
      toAddr
    );
  }

  logger.info({ to: toAddr, dedupeKey, bot: botLabel }, "Email stored via API");
  return { stored: true, duplicate: false };
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
    let isDuplicate = false;

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
        const expiredDedupeKey = makeDedupeKey(
          messageId || "",
          toAddr,
          subject || "",
          sender || "",
          "expired_fallback"
        );
        const fallbackDoc: OptionalId<MailLogDoc> = {
          _id: expiredDedupeKey,
          dedupe_key: expiredDedupeKey,
          alias_email: toAddr,
          original_to: toAddr,
          tg_user_id: alias.tg_user_id,
          from: sender || "",
          subject: subject || "(No Subject)",
          date_header: dateHeader || new Date().toISOString(),
          received_at: new Date(),
          snippet: makeSnippet(body || ""),
          body: body || "",
          read: false,
          deleted: false,
          starred: false,
          bot: key === "bot1" ? "Bot1" : "Bot2",
          admin_fallback: true,
          fallback_reason: "expired",
        };

        try {
          await db.collection<MailLogDoc>("mail_logs").insertOne(fallbackDoc);
        } catch (err: unknown) {
          const mongoErr = err as { code?: number };
          if (mongoErr?.code !== 11000) throw err;
        }

        await notifyAdminFallback(
          key,
          "expired",
          sender || "",
          subject || "(No Subject)",
          makeSnippet(body || ""),
          toAddr
        );

        logger.info({ to: toAddr, reason: "inactive_or_expired" }, "Alias not deliverable — stored as fallback");
        matched = true;
        break;
      }

      const result = await deliverEmail(
        key,
        alias,
        sender || "",
        subject || "",
        body || "",
        messageId || "",
        dateHeader || "",
        toAddr
      );
      matched = result.stored;
      isDuplicate = result.duplicate;
      break;
    }

    if (!matched) {
      const firstKey = allKeys[0] || "bot1";
      const db = getDb(firstKey);
      if (db) {
        const unassignedDedupeKey = makeDedupeKey(
          messageId || "",
          toAddr,
          subject || "",
          sender || "",
          "unassigned_fallback"
        );

        const fallbackDoc: OptionalId<MailLogDoc> = {
          _id: unassignedDedupeKey,
          dedupe_key: unassignedDedupeKey,
          alias_email: toAddr,
          original_to: toAddr,
          tg_user_id: 0,
          from: sender || "",
          subject: subject || "(No Subject)",
          date_header: dateHeader || new Date().toISOString(),
          received_at: new Date(),
          snippet: makeSnippet(body || ""),
          body: body || "",
          read: false,
          deleted: false,
          starred: false,
          bot: "Bot1",
          admin_fallback: true,
          fallback_reason: "unassigned",
        };

        try {
          await db.collection<MailLogDoc>("mail_logs").insertOne(fallbackDoc);
        } catch (err: unknown) {
          const mongoErr = err as { code?: number };
          if (mongoErr?.code !== 11000) throw err;
        }

        await notifyAdminFallback(
          firstKey as "bot1" | "bot2",
          "unassigned",
          sender || "",
          subject || "(No Subject)",
          makeSnippet(body || ""),
          toAddr
        );
      }

      logger.warn({ to: toAddr }, "No alias found — stored as unassigned fallback");
    }

    res.json({ success: true, matched, duplicate: isDuplicate });
  } catch (err) {
    logger.error({ err }, "Incoming mail error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
