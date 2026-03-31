import { Router, type IRouter } from "express";
import { authMiddleware } from "../middleware/auth";
import { getDb } from "../lib/mongo";
import type { MailLogDoc } from "../lib/mongo";

const router: IRouter = Router();

router.get("/inbox", authMiddleware, async (req, res) => {
  try {
    const user = req.user!;
    const db = getDb(user.dbKey);
    if (!db) {
      res.status(500).json({ error: "Database not available" });
      return;
    }

    const page = Math.max(0, parseInt(req.query.page as string) || 0);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));
    const search = (req.query.search as string) || "";
    const filter = (req.query.filter as string) || "all";

    const query: Record<string, unknown> = {
      alias_email: user.aliasEmail,
      deleted: { $ne: true },
    };

    if (filter === "unread") query.read = { $ne: true };
    if (filter === "starred") query.starred = true;
    if (filter === "read") query.read = true;

    if (search) {
      query.$or = [
        { subject: { $regex: search, $options: "i" } },
        { from: { $regex: search, $options: "i" } },
        { snippet: { $regex: search, $options: "i" } },
      ];
    }

    const col = db.collection<MailLogDoc>("mail_logs");

    const [mails, total, unreadCount] = await Promise.all([
      col
        .find(query, {
          projection: {
            _id: 1,
            from: 1,
            subject: 1,
            snippet: 1,
            received_at: 1,
            read: 1,
            starred: 1,
            alias_email: 1,
          },
        })
        .sort({ received_at: -1 })
        .skip(page * limit)
        .limit(limit)
        .toArray(),
      col.countDocuments(query),
      col.countDocuments({
        alias_email: user.aliasEmail,
        deleted: { $ne: true },
        read: { $ne: true },
      }),
    ]);

    res.json({
      mails: mails.map((m) => ({
        id: m._id,
        from: m.from,
        subject: m.subject,
        snippet: m.snippet,
        receivedAt: m.received_at,
        read: m.read || false,
        starred: m.starred || false,
        aliasEmail: m.alias_email,
      })),
      total,
      unreadCount,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error("Inbox error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/inbox/stats", authMiddleware, async (req, res) => {
  try {
    const user = req.user!;
    const db = getDb(user.dbKey);
    if (!db) {
      res.status(500).json({ error: "Database not available" });
      return;
    }

    const col = db.collection<MailLogDoc>("mail_logs");
    const baseQuery = { alias_email: user.aliasEmail, deleted: { $ne: true as const } };

    const [total, unread, starred] = await Promise.all([
      col.countDocuments(baseQuery),
      col.countDocuments({ ...baseQuery, read: { $ne: true as const } }),
      col.countDocuments({ ...baseQuery, starred: true }),
    ]);

    res.json({ total, unread, starred });
  } catch (err) {
    console.error("Stats error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
