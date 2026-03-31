import { Router, type IRouter } from "express";
import { authMiddleware } from "../middleware/auth";
import { getDb } from "../lib/mongo";
import type { MailLogDoc } from "../lib/mongo";

const router: IRouter = Router();

router.get("/mail/:id", authMiddleware, async (req, res) => {
  try {
    const user = req.user!;
    const db = getDb(user.dbKey);
    if (!db) {
      res.status(500).json({ error: "Database not available" });
      return;
    }

    const col = db.collection<MailLogDoc>("mail_logs");
    const mail = await col.findOne({
      _id: req.params.id as unknown as string,
      alias_email: user.aliasEmail,
    });

    if (!mail) {
      res.status(404).json({ error: "Mail not found" });
      return;
    }

    if (!mail.read) {
      await col.updateOne({ _id: mail._id }, { $set: { read: true } });
    }

    res.json({
      id: mail._id,
      from: mail.from,
      subject: mail.subject,
      body: mail.body,
      snippet: mail.snippet,
      receivedAt: mail.received_at,
      read: true,
      starred: mail.starred || false,
      deleted: mail.deleted || false,
      aliasEmail: mail.alias_email,
      dateHeader: mail.date_header,
      bot: mail.bot,
    });
  } catch (err) {
    console.error("Mail fetch error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/mail/:id", authMiddleware, async (req, res) => {
  try {
    const user = req.user!;
    const db = getDb(user.dbKey);
    if (!db) {
      res.status(500).json({ error: "Database not available" });
      return;
    }

    const { read, starred, deleted } = req.body as {
      read?: boolean;
      starred?: boolean;
      deleted?: boolean;
    };

    const update: Record<string, unknown> = {};
    if (typeof read === "boolean") update.read = read;
    if (typeof starred === "boolean") update.starred = starred;
    if (typeof deleted === "boolean") {
      update.deleted = deleted;
      if (deleted) update.deleted_at = new Date();
    }

    if (Object.keys(update).length === 0) {
      res.status(400).json({ error: "No valid fields to update" });
      return;
    }

    const col = db.collection<MailLogDoc>("mail_logs");
    const result = await col.updateOne(
      { _id: req.params.id as unknown as string, alias_email: user.aliasEmail },
      { $set: update }
    );

    if (result.matchedCount === 0) {
      res.status(404).json({ error: "Mail not found" });
      return;
    }

    res.json({ success: true, updated: update });
  } catch (err) {
    console.error("Mail update error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/mail/batch", authMiddleware, async (req, res) => {
  try {
    const user = req.user!;
    const db = getDb(user.dbKey);
    if (!db) {
      res.status(500).json({ error: "Database not available" });
      return;
    }

    const { ids, action } = req.body as {
      ids?: string[];
      action?: "read" | "unread" | "star" | "unstar" | "delete";
    };

    if (!ids?.length || !action) {
      res.status(400).json({ error: "ids and action required" });
      return;
    }

    const update: Record<string, unknown> = {};
    switch (action) {
      case "read":
        update.read = true;
        break;
      case "unread":
        update.read = false;
        break;
      case "star":
        update.starred = true;
        break;
      case "unstar":
        update.starred = false;
        break;
      case "delete":
        update.deleted = true;
        update.deleted_at = new Date();
        break;
    }

    const col = db.collection<MailLogDoc>("mail_logs");
    const result = await col.updateMany(
      { _id: { $in: ids }, alias_email: user.aliasEmail },
      { $set: update }
    );

    res.json({ success: true, modified: result.modifiedCount });
  } catch (err) {
    console.error("Batch update error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
