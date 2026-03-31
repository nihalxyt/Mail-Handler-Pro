import { logger } from "./logger";

const BOT1_TOKEN = process.env["BOT1_TG_BOT_TOKEN"] || "";
const BOT2_TOKEN = process.env["BOT2_TG_BOT_TOKEN"] || "";

const BOT1_LOG_CHANNEL = process.env["BOT1_ADMIN_LOG_CHANNEL_ID"] || "";
const BOT2_LOG_CHANNEL = process.env["BOT2_ADMIN_LOG_CHANNEL_ID"] || "";

const BOT1_SUPER_ADMINS = (process.env["BOT1_SUPER_ADMIN_IDS"] || "7166047321")
  .split(",")
  .map((s) => parseInt(s.trim(), 10))
  .filter((n) => !isNaN(n));

const BOT2_SUPER_ADMINS = (process.env["BOT2_SUPER_ADMIN_IDS"] || "7166047321")
  .split(",")
  .map((s) => parseInt(s.trim(), 10))
  .filter((n) => !isNaN(n));

function getBotToken(dbKey: "bot1" | "bot2"): string {
  return dbKey === "bot1" ? BOT1_TOKEN : BOT2_TOKEN;
}

export function getFirstAdmin(dbKey: "bot1" | "bot2"): number | null {
  const admins = dbKey === "bot1" ? BOT1_SUPER_ADMINS : BOT2_SUPER_ADMINS;
  return admins.length > 0 ? admins[0] : null;
}

function truncate(s: string, maxLen: number): string {
  if (!s) return "";
  return s.length <= maxLen ? s : s.substring(0, maxLen) + "…";
}

async function sendTelegramMessage(
  botToken: string,
  chatId: number,
  text: string
): Promise<boolean> {
  if (!botToken) {
    logger.warn("No bot token configured — skipping Telegram notification");
    return false;
  }

  try {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "Markdown",
        disable_web_page_preview: true,
      }),
    });

    if (!resp.ok) {
      const body = await resp.text();
      logger.error(
        { chatId, status: resp.status, body },
        "Telegram sendMessage failed"
      );
      return false;
    }
    return true;
  } catch (err) {
    logger.error({ err, chatId }, "Telegram notification error");
    return false;
  }
}

export async function notifyUserNewMail(
  dbKey: "bot1" | "bot2",
  tgUserId: number,
  sender: string,
  subject: string,
  snippet: string,
  aliasEmail: string
): Promise<void> {
  const token = getBotToken(dbKey);
  const text =
    `🔔 *New Mail Received*\n━━━━━━━━━━━━━━━━━━━━\n\n` +
    `👤 *From:* \`${truncate(sender, 40)}\`\n` +
    `📂 *Subject:* *${truncate(subject, 60)}*\n` +
    `📧 *To:* \`${aliasEmail}\`\n\n` +
    `*Preview:*\n${truncate(snippet, 250)}`;

  await sendTelegramMessage(token, tgUserId, text);
}

export async function notifyAdminFallback(
  dbKey: "bot1" | "bot2",
  reason: string,
  sender: string,
  subject: string,
  snippet: string,
  aliasEmail: string
): Promise<void> {
  const token = getBotToken(dbKey);
  const adminId = getFirstAdmin(dbKey);
  if (!adminId) {
    logger.warn("No admin configured for fallback notification");
    return;
  }

  const reasonLabels: Record<string, string> = {
    unassigned: "📭 Unassigned Email",
    expired: "⏰ Expired Alias",
    user_inactive: "🚫 Inactive User",
  };
  const reasonLabel = reasonLabels[reason] || "📭 Unmatched Email";

  const text =
    `🛡️ *${reasonLabel}*\n━━━━━━━━━━━━━━━━━━━━\n\n` +
    `👤 *From:* \`${truncate(sender, 40)}\`\n` +
    `📂 *Subject:* *${truncate(subject, 60)}*\n` +
    `📧 *To:* \`${aliasEmail}\`\n\n` +
    `*Preview:*\n${truncate(snippet, 250)}`;

  await sendTelegramMessage(token, adminId, text);
}

export async function sendAdminLog(
  dbKey: "bot1" | "bot2",
  action: string,
  adminName: string,
  targetType: string,
  targetId: string,
  details: string
): Promise<void> {
  const token = getBotToken(dbKey);
  const channelId = dbKey === "bot1" ? BOT1_LOG_CHANNEL : BOT2_LOG_CHANNEL;

  if (!channelId || !token) return;

  const actionEmojis: Record<string, string> = {
    role_change: "👑",
    user_ban: "🔨",
    user_approve: "✅",
    user_pending: "⏳",
    alias_activate: "🟢",
    alias_deactivate: "🔴",
    alias_extend: "📅",
    password_reset: "🔐",
  };

  const emoji = actionEmojis[action] || "📋";
  const text =
    `${emoji} *Admin Action*\n━━━━━━━━━━━━━━━━━━━━\n\n` +
    `👤 *Admin:* ${adminName}\n` +
    `📌 *Action:* \`${action}\`\n` +
    `🎯 *${targetType}:* \`${truncate(targetId, 40)}\`\n` +
    `📝 *Details:* ${truncate(details, 100)}\n` +
    `🕐 *Time:* ${new Date().toISOString()}`;

  await sendTelegramMessage(token, parseInt(channelId), text);
}
