import os
import re
import sys
import time
import json
import asyncio
import hashlib
import html as html_lib
import email
import logging
from datetime import datetime, timedelta, timezone
from email.header import decode_header
from email.utils import getaddresses
from typing import Dict, Set
from zoneinfo import ZoneInfo
from collections import OrderedDict

try:
    import uvloop
    uvloop.install()
    _UVLOOP = True
except ImportError:
    _UVLOOP = False

from telethon import TelegramClient, events, Button
from motor.motor_asyncio import AsyncIOMotorClient

try:
    from aiosmtpd.controller import Controller
    AIOSMTPD_AVAILABLE = True
except ImportError:
    AIOSMTPD_AVAILABLE = False

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("MasterMailBot")

try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    pass


# =====================================================================
# IN-MEMORY TTL CACHE — reduces MongoDB hits dramatically
# =====================================================================
class TTLCache:
    __slots__ = ("_store", "_max", "_default_ttl")

    def __init__(self, maxsize=2048, default_ttl=60):
        self._store = OrderedDict()
        self._max = maxsize
        self._default_ttl = default_ttl

    def get(self, key):
        entry = self._store.get(key)
        if entry is None:
            return None
        if time.monotonic() > entry[1]:
            self._store.pop(key, None)
            return None
        self._store.move_to_end(key)
        return entry[0]

    def set(self, key, value, ttl=None):
        if ttl is None:
            ttl = self._default_ttl
        self._store[key] = (value, time.monotonic() + ttl)
        self._store.move_to_end(key)
        while len(self._store) > self._max:
            self._store.popitem(last=False)

    def invalidate(self, key):
        self._store.pop(key, None)

    def invalidate_prefix(self, prefix):
        to_del = [k for k in self._store if isinstance(k, str) and k.startswith(prefix)]
        for k in to_del:
            self._store.pop(k, None)

    def clear(self):
        self._store.clear()


# =====================================================================
# BOT 1 CONFIG (Nihal)
# =====================================================================
BOT1_TG_API_ID   = int(os.environ.get("BOT1_TG_API_ID",   "38476908"))
BOT1_TG_API_HASH = os.environ.get("BOT1_TG_API_HASH",     "51189635e11bdf468bd37f0935b03f41")
BOT1_TG_TOKEN    = os.environ.get("BOT1_TG_BOT_TOKEN",    "6555670943:AAEdyqV2-gGSBZ7no0jHdZroB0UJCvcSKLI")
BOT1_MONGO_URI   = os.environ.get("BOT1_MONGO_URI",       "mongodb+srv://nihal:Nihal119@verified.a3hzz.mongodb.net/?retryWrites=true&w=majority&appName=Verified")
BOT1_DB_NAME     = os.environ.get("BOT1_DB_NAME",         "mailbot_pro")
BOT1_SUPER_ADMIN_IDS: Set[int] = {7166047321, 6100176781}

# =====================================================================
# BOT 2 CONFIG (Maruf)
# =====================================================================
BOT2_TG_API_ID   = int(os.environ.get("BOT2_TG_API_ID",   "38476908"))
BOT2_TG_API_HASH = os.environ.get("BOT2_TG_API_HASH",     "51189635e11bdf468bd37f0935b03f41")
BOT2_TG_TOKEN    = os.environ.get("BOT2_TG_BOT_TOKEN",    "8212911955:AAEc2z35pyWJkWnqK5MpG4ImHmy6TYB5kkg")
BOT2_MONGO_URI   = os.environ.get("BOT2_MONGO_URI",       "mongodb+srv://marufshikder010:Maruf998@tender.qzyvgs7.mongodb.net/?retryWrites=true&w=majority&appName=Tender")
BOT2_DB_NAME     = os.environ.get("BOT2_DB_NAME",         "mailbot_pro")
BOT2_SUPER_ADMIN_IDS: Set[int] = {7166047321, 6100176781}

# =====================================================================
# SMTP CONFIG
# =====================================================================
SMTP_HOST = os.environ.get("SMTP_HOST", "0.0.0.0")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "25"))

# =====================================================================
# SHARED CONSTANTS
# =====================================================================
UTC      = timezone.utc
LOCAL_TZ = ZoneInfo("Asia/Dhaka")
EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}", re.I)
_RE_SCRIPT  = re.compile(r'<(script|style|head|title|meta)[^>]*>.*?</\1>', re.DOTALL | re.I)
_RE_COMMENT = re.compile(r'<!--.*?-->', re.DOTALL)
_RE_BOLD    = re.compile(r'<(b|strong)[^>]*>(.*?)</\1>', re.DOTALL | re.I)
_RE_ITALIC  = re.compile(r'<(i|em)[^>]*>(.*?)</\1>', re.DOTALL | re.I)
_RE_CODE    = re.compile(r'<(code|pre)[^>]*>(.*?)</\1>', re.DOTALL | re.I)
_RE_BLOCK   = re.compile(r'</?(div|p|h[1-6]|tr|li|ul|ol|blockquote|table)[^>]*>', re.I)
_RE_BR      = re.compile(r'<br\s*/?>', re.I)
_RE_LINK    = re.compile(r'<a\s+(?:[^>]*?\s+)?href=["\'](.*?)["\'][^>]*>(.*?)</a>', re.DOTALL | re.I)
_RE_TAG     = re.compile(r'<[^>]+>')
_RE_ZWSP    = re.compile(r'[\u200b\u200c\u200d\u2060\ufeff]')
_RE_SPACES  = re.compile(r'[ \t]+')
_RE_BLANKS  = re.compile(r'\n\s*\n+')
PAGE_SIZE       = 10
ADMIN_PAGE_SIZE = 8

# =====================================================================
# MONGODB  — optimized connection pooling
# =====================================================================
_MONGO_OPTS = {"maxPoolSize": 20, "minPoolSize": 2, "maxIdleTimeMS": 45000,
               "connectTimeoutMS": 5000, "serverSelectionTimeoutMS": 5000,
               "retryWrites": True, "w": "majority"}
mongo1 = AsyncIOMotorClient(BOT1_MONGO_URI, **_MONGO_OPTS)
db1    = mongo1[BOT1_DB_NAME]
bot1_col_users    = db1["users"]
bot1_col_aliases  = db1["aliases"]
bot1_col_logs     = db1["mail_logs"]
bot1_col_settings = db1["settings"]
bot1_col_stats    = db1["statistics"]

mongo2 = AsyncIOMotorClient(BOT2_MONGO_URI, **_MONGO_OPTS)
db2    = mongo2[BOT2_DB_NAME]
bot2_col_users    = db2["users"]
bot2_col_aliases  = db2["aliases"]
bot2_col_logs     = db2["mail_logs"]
bot2_col_settings = db2["settings"]
bot2_col_stats    = db2["statistics"]

# =====================================================================
# TELEGRAM CLIENTS
# =====================================================================
bot1 = TelegramClient("bot1_session", BOT1_TG_API_ID, BOT1_TG_API_HASH)
bot2 = TelegramClient("bot2_session", BOT2_TG_API_ID, BOT2_TG_API_HASH)

# =====================================================================
# ALIAS CACHES (per bot) — in‑memory dict cache
# =====================================================================
bot1_alias_cache = {"by_email": {}, "all_emails": set(), "updated_at": 0.0}
bot1_alias_token_cache = {}
bot1_alias_token_updated_at = 0.0

bot2_alias_cache = {"by_email": {}, "all_emails": set(), "updated_at": 0.0}
bot2_alias_token_cache = {}
bot2_alias_token_updated_at = 0.0

bot1_admin_state: Dict[int, dict] = {}
bot2_admin_state: Dict[int, dict] = {}

# =====================================================================
# PER-BOT TTL CACHES  — user lookups, counts, access checks
# =====================================================================
bot1_user_cache  = TTLCache(maxsize=4096, default_ttl=120)
bot1_count_cache = TTLCache(maxsize=1024, default_ttl=30)
bot2_user_cache  = TTLCache(maxsize=4096, default_ttl=120)
bot2_count_cache = TTLCache(maxsize=1024, default_ttl=30)


def _ctx_caches(bot_instance):
    if bot_instance is bot1:
        return bot1_user_cache, bot1_count_cache
    return bot2_user_cache, bot2_count_cache


# =====================================================================
# CACHED DB HELPERS — read‑through TTL cache, write‑invalidate
# =====================================================================
async def cached_find_user(tg_user_id, col_users, user_cache):
    key = f"u:{tg_user_id}"
    hit = user_cache.get(key)
    if hit is not None:
        return hit
    u = await col_users.find_one({"tg_user_id": tg_user_id})
    if u:
        user_cache.set(key, u, ttl=120)
    return u

async def invalidate_user(tg_user_id, user_cache):
    user_cache.invalidate(f"u:{tg_user_id}")

async def cached_count(col, query, count_cache, cache_key, ttl=30):
    hit = count_cache.get(cache_key)
    if hit is not None:
        return hit
    val = await col.count_documents(query)
    count_cache.set(cache_key, val, ttl=ttl)
    return val


# =====================================================================
# UTILITY FUNCTIONS
# =====================================================================
def now_utc():
    return datetime.now(UTC)

def make_aware(dt):
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt

def format_datetime(dt):
    if not dt:
        return "N/A"
    dt = make_aware(dt).astimezone(LOCAL_TZ)
    return dt.strftime("%Y-%m-%d %I:%M %p")

def day_start_utc():
    local_now = datetime.now(LOCAL_TZ)
    local_midnight = local_now.replace(hour=0, minute=0, second=0, microsecond=0)
    return local_midnight.astimezone(UTC)

def decode_str(s):
    if not s:
        return ""
    try:
        parts = decode_header(s)
        out = ""
        for text_part, enc in parts:
            if isinstance(text_part, bytes):
                out += text_part.decode(enc or "utf-8", errors="replace")
            else:
                out += text_part
        return out
    except Exception:
        return str(s)

def get_text_body(msg):
    if msg.is_multipart():
        html_part = text_part = None
        for part in msg.walk():
            ctype = part.get_content_type()
            disp = str(part.get("Content-Disposition", ""))
            if "attachment" in disp.lower():
                continue
            if ctype == "text/plain" and text_part is None:
                payload = part.get_payload(decode=True)
                charset = part.get_content_charset() or "utf-8"
                if payload:
                    text_part = payload.decode(charset, errors="replace")
            elif ctype == "text/html" and html_part is None:
                payload = part.get_payload(decode=True)
                charset = part.get_content_charset() or "utf-8"
                if payload:
                    html_part = payload.decode(charset, errors="replace")
        return html_part or text_part or ""
    payload = msg.get_payload(decode=True) or b""
    charset = msg.get_content_charset() or "utf-8"
    return payload.decode(charset, errors="replace")

def clean_html_body(html_text, max_len=4000):
    if not html_text:
        return "No content available."
    text = html_text.replace('\r\n', '\n').replace('\r', '\n')
    text = _RE_SCRIPT.sub('', text)
    text = _RE_COMMENT.sub('', text)
    text = _RE_BOLD.sub(r'\2', text)
    text = _RE_ITALIC.sub(r'\2', text)
    text = _RE_CODE.sub(r'\2', text)
    text = _RE_BLOCK.sub('\n', text)
    text = _RE_BR.sub('\n', text)

    def link_repl(m):
        url = m.group(1)
        link_text = _RE_TAG.sub('', m.group(2)).strip()
        if not link_text:
            return " [Link] "
        if not url or not url.startswith(('http', 'https', 'mailto')):
            return link_text
        return f"[{link_text}]({url})"

    text = _RE_LINK.sub(link_repl, text)
    text = _RE_TAG.sub('', text)
    text = html_lib.unescape(text)
    text = _RE_ZWSP.sub('', text)
    text = text.replace('\xa0', ' ')
    text = _RE_SPACES.sub(' ', text)
    text = _RE_BLANKS.sub('\n\n', text).strip()
    if len(text) > max_len:
        return text[:max_len] + "...\n\n**(Message Truncated)**"
    return text

def short(s, n=50):
    s = (s or "").strip()
    return s if len(s) <= n else s[:n] + "…"

def sha256(s):
    return hashlib.sha256(s.encode("utf-8", errors="ignore")).hexdigest()

def cb(*parts):
    data = "|".join(str(p) for p in parts)
    return data.encode("utf-8")[:64]

def time_remaining(expires_at):
    if not expires_at:
        return "N/A"
    expires_at = make_aware(expires_at)
    delta = expires_at - now_utc()
    if delta.total_seconds() < 0:
        return "Expired"
    days = delta.days
    if days > 1:
        return f"{days} days"
    elif days == 1:
        return "1 day"
    else:
        hours = int(delta.total_seconds() / 3600)
        mins = int((delta.total_seconds() % 3600) / 60)
        if hours > 0:
            return f"{hours}h {mins}m"
        return f"{mins} minutes"


# =====================================================================
# DB INDEXES
# =====================================================================
async def ensure_indexes(col_users, col_aliases, col_logs):
    await col_users.create_index("tg_user_id", unique=True)
    await col_users.create_index("username")
    await col_users.create_index([("status", 1), ("role", 1)])
    await col_aliases.create_index("alias_email", unique=True)
    await col_aliases.create_index([("tg_user_id", 1), ("active", 1)])
    await col_aliases.create_index([("expires_at", 1)])
    await col_aliases.create_index([("active", 1), ("expires_at", 1)])
    await col_logs.create_index("dedupe_key", unique=True)
    await col_logs.create_index([("tg_user_id", 1), ("received_at", -1)])
    await col_logs.create_index([("alias_email", 1), ("received_at", -1)])
    await col_logs.create_index([("deleted", 1), ("tg_user_id", 1)])
    await col_logs.create_index([("read", 1), ("tg_user_id", 1)])


# =====================================================================
# ALIAS CACHE FUNCTIONS
# =====================================================================
async def refresh_alias_cache(col_aliases, alias_cache, force=False):
    if not force and (time.time() - alias_cache["updated_at"] < 8):
        return
    now = now_utc()
    cur = col_aliases.find({"active": True, "expires_at": {"$gt": now}})
    new_map = {}
    async for a in cur:
        new_map[a["alias_email"].lower()] = {
            "user_id": a.get("user_id", f"U{a['tg_user_id']}"),
            "tg_user_id": a["tg_user_id"],
            "expires_at": a["expires_at"],
        }
    all_cur = col_aliases.find({}, {"alias_email": 1})
    all_emails = set()
    async for a in all_cur:
        all_emails.add(a["alias_email"].lower())
    alias_cache["by_email"] = new_map
    alias_cache["all_emails"] = all_emails
    alias_cache["updated_at"] = time.time()

async def refresh_alias_tokens(col_aliases, token_cache):
    token_cache.clear()
    async for a in col_aliases.find({}):
        token = sha256(a["alias_email"])[:12]
        token_cache[token] = a["alias_email"].lower()

async def refresh_bot1_alias_cache(force=False):
    await refresh_alias_cache(bot1_col_aliases, bot1_alias_cache, force)
async def refresh_bot1_alias_tokens(force=False):
    global bot1_alias_token_updated_at
    if not force and (time.time() - bot1_alias_token_updated_at < 30):
        return
    await refresh_alias_tokens(bot1_col_aliases, bot1_alias_token_cache)
    bot1_alias_token_updated_at = time.time()

async def refresh_bot2_alias_cache(force=False):
    await refresh_alias_cache(bot2_col_aliases, bot2_alias_cache, force)
async def refresh_bot2_alias_tokens(force=False):
    global bot2_alias_token_updated_at
    if not force and (time.time() - bot2_alias_token_updated_at < 30):
        return
    await refresh_alias_tokens(bot2_col_aliases, bot2_alias_token_cache)
    bot2_alias_token_updated_at = time.time()


# =====================================================================
# CROSS-BOT EMAIL UNIQUENESS CHECK
# =====================================================================
def email_exists_in_other_bot(alias_email, current_bot_instance):
    alias_lower = alias_email.lower()
    if current_bot_instance is bot1:
        return alias_lower in bot2_alias_cache["all_emails"]
    else:
        return alias_lower in bot1_alias_cache["all_emails"]

async def email_exists_in_other_bot_db(alias_email, current_bot_instance):
    alias_lower = alias_email.lower()
    if current_bot_instance is bot1:
        found = await bot2_col_aliases.find_one({"alias_email": alias_lower})
    else:
        found = await bot1_col_aliases.find_one({"alias_email": alias_lower})
    return found is not None


# =====================================================================
# USER / ACCESS HELPERS  (cached)
# =====================================================================
async def is_super_admin(tg_user_id, super_admin_ids):
    return tg_user_id in super_admin_ids

async def is_admin(tg_user_id, col_users, super_admin_ids, user_cache=None):
    if tg_user_id in super_admin_ids:
        return True
    if user_cache:
        u = await cached_find_user(tg_user_id, col_users, user_cache)
    else:
        u = await col_users.find_one({"tg_user_id": tg_user_id})
    return u and u.get("role") in ["admin", "moderator"]

async def get_or_create_user(tg_user_id, col_users, super_admin_ids, user_cache, username="", name=""):
    u = await cached_find_user(tg_user_id, col_users, user_cache)
    if u:
        update_data = {"updated_at": now_utc()}
        changed = False
        if username and u.get("username") != username:
            update_data["username"] = username
            changed = True
        if name and u.get("name") != name:
            update_data["name"] = name
            changed = True
        if changed:
            await col_users.update_one({"tg_user_id": tg_user_id}, {"$set": update_data})
            await invalidate_user(tg_user_id, user_cache)
        return u
    user_id = f"U{tg_user_id}"
    u = {
        "_id": user_id,
        "tg_user_id": tg_user_id,
        "username": username or "",
        "name": name or "",
        "role": "user",
        "status": "pending",
        "created_at": now_utc(),
        "updated_at": now_utc(),
        "notifications": True,
        "stats": {"total_mails": 0, "total_aliases": 0}
    }
    if tg_user_id in super_admin_ids:
        u["status"] = "active"
        u["role"] = "super_admin"
    try:
        await col_users.insert_one(u)
    except Exception:
        u = await col_users.find_one({"tg_user_id": tg_user_id})
    if u:
        user_cache.set(f"u:{tg_user_id}", u, ttl=120)
    return u

async def check_user_access(tg_user_id, col_users, user_cache):
    u = await cached_find_user(tg_user_id, col_users, user_cache)
    if not u:
        return False, "not_registered"
    status = u.get("status", "pending")
    if status == "active":
        return True, "active"
    elif status == "pending":
        return False, "pending"
    elif status == "banned":
        return False, "banned"
    return False, "unknown"


# =====================================================================
# KEYBOARD BUILDERS
# =====================================================================
def admin_main_kb():
    return [
        [Button.inline("👥 User Management", cb("A", "users")),
         Button.inline("📧 Email Management", cb("A", "aliases"))],
        [Button.inline("📊 Statistics & Reports", cb("A", "stats")),
         Button.inline("📢 Broadcast", cb("A", "broadcast"))],
        [Button.inline("🛡️ Admin Inbox", cb("A", "admin_inbox", "0")),
         Button.inline("🔧 System Settings", cb("A", "settings"))],
        [Button.inline("📋 Activity Log", cb("A", "activity")),
         Button.inline("🔄 Refresh Cache", cb("A", "refresh"))],
    ]

def users_management_kb():
    return [
        [Button.inline("➕ Add User", cb("U", "add")),
         Button.inline("🔍 Search User", cb("U", "search"))],
        [Button.inline("📋 Active Users", cb("U", "list", "active", "0")),
         Button.inline("⏳ Pending Users", cb("U", "list", "pending", "0"))],
        [Button.inline("⛔ Banned Users", cb("U", "list", "banned", "0")),
         Button.inline("👑 All Admins", cb("U", "list", "admin", "0"))],
        [Button.inline("📊 User Stats", cb("U", "overview")),
         Button.inline("⬅️ Back", cb("A", "back"))],
    ]

def user_detail_kb(tg_id, status, role="user"):
    buttons = []
    buttons.append([
        Button.inline("📧 Manage Emails", cb("UM", "emails", str(tg_id))),
        Button.inline("➕ Add Email", cb("UM", "addemail", str(tg_id)))
    ])
    buttons.append([
        Button.inline("📊 User Stats", cb("UM", "stats", str(tg_id))),
        Button.inline("📥 User Inbox", cb("UM", "inbox", str(tg_id), "0"))
    ])
    if status == "pending":
        buttons.append([
            Button.inline("✅ Approve", cb("UM", "approve", str(tg_id))),
            Button.inline("❌ Reject", cb("UM", "reject", str(tg_id)))
        ])
    elif status == "active":
        action_row = []
        if role not in ["admin", "super_admin", "moderator"]:
            action_row.append(Button.inline("👑 Make Admin", cb("UM", "mkadmin", str(tg_id))))
        else:
            action_row.append(Button.inline("👤 Remove Admin", cb("UM", "rmadmin", str(tg_id))))
        action_row.append(Button.inline("⛔ Ban", cb("UM", "ban", str(tg_id))))
        buttons.append(action_row)
    elif status == "banned":
        buttons.append([Button.inline("✅ Unban User", cb("UM", "unban", str(tg_id)))])
    buttons.append([
        Button.inline("🗑️ Delete User", cb("UM", "delconfirm", str(tg_id))),
        Button.inline("⬅️ Back", cb("A", "users"))
    ])
    return buttons

def aliases_kb():
    return [
        [Button.inline("➕ Create Email", cb("E", "add")),
         Button.inline("🔍 Search Email", cb("E", "search"))],
        [Button.inline("📋 Active Emails", cb("E", "list", "active", "0")),
         Button.inline("❌ Expired Emails", cb("E", "list", "expired", "0"))],
        [Button.inline("📋 All Emails", cb("E", "list", "all", "0")),
         Button.inline("📊 Email Stats", cb("E", "overview"))],
        [Button.inline("🗑️ Cleanup Expired", cb("E", "cleanup")),
         Button.inline("⬅️ Back", cb("A", "back"))],
    ]

def alias_actions_kb(token, is_active):
    buttons = []
    if is_active:
        buttons.append([
            Button.inline("⏰ +30 Days", cb("EA", token, "30")),
            Button.inline("⏰ +90 Days", cb("EA", token, "90"))
        ])
        buttons.append([
            Button.inline("⏰ +180 Days", cb("EA", token, "180")),
            Button.inline("⏰ +365 Days", cb("EA", token, "365"))
        ])
        buttons.append([
            Button.inline("🔄 Reassign User", cb("EA", token, "reassign")),
            Button.inline("🗑️ Deactivate", cb("ED", token))
        ])
    else:
        buttons.append([
            Button.inline("♻️ Reactivate +30d", cb("ER", token, "30")),
            Button.inline("♻️ Reactivate +90d", cb("ER", token, "90"))
        ])
        buttons.append([Button.inline("🗑️ Delete Permanently", cb("EP", token))])
        buttons.append([Button.inline("⬅️ Back", cb("E", "list", "active", "0"))])
    return buttons

def duration_kb(prefix="D"):
    return [
        [Button.inline("7 Days", cb(prefix, "7")), Button.inline("15 Days", cb(prefix, "15"))],
        [Button.inline("✅ 30 Days", cb(prefix, "30")), Button.inline("60 Days", cb(prefix, "60"))],
        [Button.inline("90 Days", cb(prefix, "90")), Button.inline("180 Days", cb(prefix, "180"))],
        [Button.inline("365 Days", cb(prefix, "365")), Button.inline("✏️ Custom", cb(prefix, "custom"))],
        [Button.inline("❌ Cancel", cb("X", "cancel"))],
    ]

def user_main_kb():
    return [
        [Button.inline("📥 Inbox", cb("M", "inbox", "0")),
         Button.inline("📧 My Emails", cb("M", "emails"))],
        [Button.inline("⭐ Starred", cb("M", "starred", "0")),
         Button.inline("📊 Statistics", cb("M", "stats"))],
        [Button.inline("⚙️ Settings", cb("M", "settings")),
         Button.inline("ℹ️ Help", cb("M", "help"))],
    ]

def user_reply_kb():
    return [
        [Button.text("📥 Inbox", resize=True), Button.text("📧 My Emails", resize=True)],
        [Button.text("⭐ Starred", resize=True), Button.text("📊 Statistics", resize=True)],
        [Button.text("⚙️ Settings", resize=True), Button.text("ℹ️ Help", resize=True)],
    ]

def admin_reply_kb():
    return [
        [Button.text("🛠️ Admin Panel", resize=True), Button.text("📥 Inbox", resize=True)],
        [Button.text("📧 My Emails", resize=True), Button.text("⭐ Starred", resize=True)],
        [Button.text("📊 Statistics", resize=True)],
    ]

def settings_kb():
    return [
        [Button.inline("📢 Broadcast to All", cb("A", "broadcast", "all")),
         Button.inline("📢 Broadcast Active", cb("A", "broadcast", "active"))],
        [Button.inline("🔄 Refresh All Caches", cb("A", "refresh")),
         Button.inline("🧹 DB Cleanup", cb("A", "dbclean"))],
        [Button.inline("⬅️ Back", cb("A", "back"))],
    ]


# =====================================================================
# PANEL / VIEW FUNCTIONS  (using cached counts)
# =====================================================================
async def admin_panel(event, bot_instance, col_users, col_aliases, col_logs, count_cache, edit=False):
    now = now_utc()
    ds = day_start_utc()
    total_users, active_users, pending_users, banned_users = await asyncio.gather(
        cached_count(col_users, {}, count_cache, "cnt:users:total"),
        cached_count(col_users, {"status": "active"}, count_cache, "cnt:users:active"),
        cached_count(col_users, {"status": "pending"}, count_cache, "cnt:users:pending"),
        cached_count(col_users, {"status": "banned"}, count_cache, "cnt:users:banned"),
    )
    total_aliases, expired_aliases, today_mails, total_mails = await asyncio.gather(
        cached_count(col_aliases, {"active": True}, count_cache, "cnt:aliases:active"),
        cached_count(col_aliases, {"$or": [{"active": False}, {"expires_at": {"$lte": now}}]}, count_cache, "cnt:aliases:expired"),
        cached_count(col_logs, {"received_at": {"$gte": ds}}, count_cache, "cnt:mails:today", ttl=15),
        cached_count(col_logs, {}, count_cache, "cnt:mails:total"),
    )
    text = (
        "🛠️ **Admin Dashboard**\n"
        "━━━━━━━━━━━━━━━━━━━━\n\n"
        "👥 **Users:**\n"
        f" ├ Total: **{total_users}**\n"
        f" ├ Active: **{active_users}**\n"
        f" ├ Pending: **{pending_users}**\n"
        f" └ Banned: **{banned_users}**\n\n"
        "📧 **Emails:**\n"
        f" ├ Active: **{total_aliases}**\n"
        f" └ Expired: **{expired_aliases}**\n\n"
        "📨 **Mail Activity:**\n"
        f" ├ Today: **{today_mails}**\n"
        f" └ Total: **{total_mails}**\n\n"
        "Select an option below:"
    )
    if edit:
        return await event.edit(text, buttons=admin_main_kb())
    await event.respond("✅ **Quick actions are ready below.**", buttons=admin_reply_kb())
    return await event.respond(text, buttons=admin_main_kb())

async def user_panel(event, col_users, col_aliases, col_logs, user_cache, count_cache, edit=False):
    u = await cached_find_user(event.sender_id, col_users, user_cache)
    if not u:
        return await event.respond("❌ User not found. Please use /start")
    sid = event.sender_id
    now = now_utc()
    active_aliases, unread_mails, starred_mails = await asyncio.gather(
        cached_count(col_aliases, {"tg_user_id": sid, "active": True, "expires_at": {"$gt": now}}, count_cache, f"cnt:ualias:{sid}", ttl=20),
        cached_count(col_logs, {"tg_user_id": sid, "deleted": {"$ne": True}, "read": {"$ne": True}}, count_cache, f"cnt:unread:{sid}", ttl=15),
        cached_count(col_logs, {"tg_user_id": sid, "deleted": {"$ne": True}, "starred": True}, count_cache, f"cnt:star:{sid}", ttl=20),
    )
    username_display = f"@{u.get('username')}" if u.get("username") else "Not set"
    text = (
        f"👋 Welcome, {u.get('name', 'User')}!\n"
        "━━━━━━━━━━━━━━━━━━━━\n\n"
        "👤 Profile\n"
        f" ├ Name: {u.get('name', 'N/A')}\n"
        f" ├ Username: {username_display}\n"
        f" └ ID: {u.get('tg_user_id')}\n\n"
        "📊 Account\n"
        f" ├ Status: ✅ Authorized\n"
        f" ├ Active Emails: {active_aliases}\n"
        f" ├ Unread Mails: {unread_mails}\n"
        f" └ Starred: {starred_mails}\n\n"
        "What would you like to do?"
    )
    if edit:
        return await event.edit(text, buttons=user_main_kb())
    await event.respond("✅ Quick actions are ready below.", buttons=user_reply_kb())
    return await event.respond(text, buttons=user_main_kb())

async def show_inbox(event, col_logs, page=0, edit=False):
    sender_id = event.sender_id
    total = await col_logs.count_documents({"tg_user_id": sender_id, "deleted": {"$ne": True}})
    logs = await col_logs.find({
        "tg_user_id": sender_id, "deleted": {"$ne": True}
    }).sort("received_at", -1).skip(page * PAGE_SIZE).limit(PAGE_SIZE + 1).to_list(PAGE_SIZE + 1)
    has_more = len(logs) > PAGE_SIZE
    logs = logs[:PAGE_SIZE]
    total_pages = max(1, (total + PAGE_SIZE - 1) // PAGE_SIZE)
    text = (
        f"📥 **Inbox** — Page {page + 1}/{total_pages}\n"
        f"━━━━━━━━━━━━━━━━━━━━\n"
        f"📊 Total: {total} emails\n\n"
    )
    buttons = []
    if not logs:
        text += "🚫 _No emails found._"
    else:
        for lg in logs:
            log_id = lg["_id"][:20]
            read_icon = "📖" if lg.get("read") else "📩"
            star = "⭐" if lg.get("starred") else ""
            from_clean = short(lg.get('from', 'Unknown').split('<')[0].replace('"', '').strip(), 22)
            subject_clean = short(lg.get('subject', 'No subject'), 30)
            time_str = format_datetime(lg.get('received_at'))
            text += f"{star}{read_icon} **{from_clean}**\n"
            text += f" └ {subject_clean}\n"
            text += f" └ 📅 {time_str}\n\n"
            btn_label = f"{star}{read_icon} {short(subject_clean, 28)}"
            buttons.append([Button.inline(btn_label, cb("ML", log_id))])
    nav = []
    if page > 0:
        nav.append(Button.inline("⬅️ Prev", cb("MI", str(page - 1))))
    if total > 0:
        nav.append(Button.inline(f"📄 {page + 1}/{total_pages}", cb("NOP")))
    if has_more:
        nav.append(Button.inline("Next ➡️", cb("MI", str(page + 1))))
    if nav:
        buttons.append(nav)
    buttons.append([Button.inline("🔄 Refresh", cb("M", "inbox", "0")), Button.inline("⬅️ Dashboard", cb("M", "back"))])
    if edit:
        return await event.edit(text, buttons=buttons)
    return await event.respond(text, buttons=buttons)

async def show_starred(event, col_logs, page=0, edit=False):
    logs = await col_logs.find({
        "tg_user_id": event.sender_id, "deleted": {"$ne": True}, "starred": True
    }).sort("received_at", -1).skip(page * PAGE_SIZE).limit(PAGE_SIZE + 1).to_list(PAGE_SIZE + 1)
    has_more = len(logs) > PAGE_SIZE
    logs = logs[:PAGE_SIZE]
    text = f"⭐ **Starred Mails** — Page {page + 1}\n━━━━━━━━━━━━━━━━━━━━\n\n"
    buttons = []
    if not logs:
        text += "🚫 _No starred emails._"
    else:
        for lg in logs:
            log_id = lg["_id"][:20]
            from_clean = short(lg.get('from', 'Unknown').split('<')[0].replace('"', '').strip(), 22)
            subject_clean = short(lg.get('subject', 'No subject'), 30)
            text += f"⭐ **{from_clean}**\n └ {subject_clean}\n\n"
            buttons.append([Button.inline(f"⭐ {short(subject_clean, 30)}", cb("ML", log_id))])
    nav = []
    if page > 0:
        nav.append(Button.inline("⬅️ Prev", cb("MST", str(page - 1))))
    if has_more:
        nav.append(Button.inline("Next ➡️", cb("MST", str(page + 1))))
    if nav:
        buttons.append(nav)
    buttons.append([Button.inline("⬅️ Dashboard", cb("M", "back"))])
    if edit:
        return await event.edit(text, buttons=buttons)
    return await event.respond(text, buttons=buttons)

async def show_user_emails(event, col_aliases, col_logs, edit=False):
    now = now_utc()
    aliases = await col_aliases.find({"tg_user_id": event.sender_id}).sort("created_at", -1).limit(50).to_list(50)
    text = "📧 My Email Aliases\n━━━━━━━━━━━━━━━━━━━━\n\n"
    for a in aliases:
        exp_aware = make_aware(a.get("expires_at"))
        is_active = a.get("active") and exp_aware and exp_aware > now
        status_emoji = "✅" if is_active else "❌"
        mail_count = await col_logs.count_documents({"alias_email": a["alias_email"], "tg_user_id": event.sender_id})
        text += f"{status_emoji} {a['alias_email']}\n"
        text += f" ├ Expires: {time_remaining(exp_aware)}\n"
        text += f" └ Mails: {mail_count}\n\n"
    if not aliases:
        text += "No email aliases yet.\nContact admin to get one assigned."
    if edit:
        return await event.edit(text, buttons=[[Button.inline("⬅️ Back", cb("M", "back"))]])
    return await event.respond(text, buttons=[[Button.inline("⬅️ Back", cb("M", "back"))]])

async def show_user_stats(event, col_users, col_aliases, col_logs, user_cache, edit=False):
    u = await cached_find_user(event.sender_id, col_users, user_cache)
    sid = event.sender_id
    now = now_utc()
    total_aliases  = await col_aliases.count_documents({"tg_user_id": sid})
    active_aliases = await col_aliases.count_documents({"tg_user_id": sid, "active": True, "expires_at": {"$gt": now}})
    total_mails    = await col_logs.count_documents({"tg_user_id": sid, "deleted": {"$ne": True}})
    unread_mails   = await col_logs.count_documents({"tg_user_id": sid, "read": {"$ne": True}, "deleted": {"$ne": True}})
    starred        = await col_logs.count_documents({"tg_user_id": sid, "starred": True, "deleted": {"$ne": True}})
    today_mails    = await col_logs.count_documents({"tg_user_id": sid, "received_at": {"$gte": day_start_utc()}})
    text = (
        "📊 Your Statistics\n━━━━━━━━━━━━━━━━━━━━\n\n"
        f"📅 Account:\n"
        f" └ Member Since: {format_datetime(u.get('created_at') if u else None)}\n\n"
        f"📧 Email Aliases:\n"
        f" ├ Total: {total_aliases}\n"
        f" └ Active: {active_aliases}\n\n"
        f"📨 Mail Activity:\n"
        f" ├ Total: {total_mails}\n"
        f" ├ Unread: {unread_mails}\n"
        f" ├ Starred: {starred}\n"
        f" └ Today: {today_mails}"
    )
    if edit:
        return await event.edit(text, buttons=[[Button.inline("⬅️ Back", cb("M", "back"))]])
    return await event.respond(text, buttons=[[Button.inline("⬅️ Back", cb("M", "back"))]])

async def show_user_settings(event, col_users, user_cache, edit=False):
    u = await cached_find_user(event.sender_id, col_users, user_cache)
    notif = u.get("notifications", True) if u else True
    notif_status = "✅ ON" if notif else "❌ OFF"
    text = ("⚙️ Settings\n━━━━━━━━━━━━━━━━━━━━\n\n" f"🔔 Notifications: {notif_status}")
    buttons = [
        [Button.inline(f"🔔 Toggle Notifications ({notif_status})", cb("SET", "notif"))],
        [Button.inline("🗑️ Clear All Mails", cb("SET", "clear_confirm"))],
        [Button.inline("🗑️ Clear Read Mails Only", cb("SET", "clear_read"))],
        [Button.inline("⬅️ Back", cb("M", "back"))]
    ]
    if edit:
        return await event.edit(text, buttons=buttons)
    return await event.respond(text, buttons=buttons)

async def show_user_help(event, edit=False):
    help_text = (
        "ℹ️ Help & Support\n━━━━━━━━━━━━━━━━━━━━\n\n"
        "📧 Features:\n"
        " • Receive emails directly in Telegram\n"
        " • Multiple email aliases supported\n"
        " • Star important emails\n"
        " • Real-time notifications\n"
        " • Read full email content\n\n"
        "📖 How to Use:\n"
        " 1. Admin adds your access\n"
        " 2. Admin assigns email aliases to you\n"
        " 3. Emails sent to your aliases appear here\n"
        " 4. Tap on emails to read full content\n"
        " 5. Star important ones for quick access\n\n"
        "🆘 Need Help?\n"
        " Contact your administrator."
    )
    if edit:
        return await event.edit(help_text, buttons=[[Button.inline("⬅️ Back", cb("M", "back"))]])
    return await event.respond(help_text, buttons=[[Button.inline("⬅️ Back", cb("M", "back"))]])

async def show_admin_inbox(event, col_logs, super_admin_ids, page=0, edit=False):
    admin_ids = list(super_admin_ids)
    logs = await col_logs.find({
        "tg_user_id": {"$in": admin_ids}, "deleted": {"$ne": True}
    }).sort("received_at", -1).skip(page * PAGE_SIZE).limit(PAGE_SIZE + 1).to_list(PAGE_SIZE + 1)
    has_more = len(logs) > PAGE_SIZE
    logs = logs[:PAGE_SIZE]
    total = await col_logs.count_documents({"tg_user_id": {"$in": admin_ids}, "deleted": {"$ne": True}})
    text = (
        f"🛡️ **Admin Inbox** — Page {page + 1}\n"
        "━━━━━━━━━━━━━━━━━━━━\n"
        f"📊 Total: {total} | Unassigned & expired emails\n\n"
    )
    buttons = []
    if not logs:
        text += "🚫 _No admin emails._"
    else:
        for lg in logs:
            log_id = lg["_id"][:20]
            from_clean = short(lg.get('from', 'Unknown').split('<')[0].replace('"', '').strip(), 22)
            subject_clean = short(lg.get('subject', 'No subject'), 28)
            to_email = lg.get('alias_email', lg.get('original_to', 'Unknown'))
            text += f"📩 **{from_clean}**\n"
            text += f" ├ {subject_clean}\n"
            text += f" └ To: `{short(to_email, 30)}`\n\n"
            buttons.append([Button.inline(f"📩 {short(subject_clean, 28)}", cb("ML", log_id))])
    nav = []
    if page > 0:
        nav.append(Button.inline("⬅️ Prev", cb("AI", str(page - 1))))
    if has_more:
        nav.append(Button.inline("Next ➡️", cb("AI", str(page + 1))))
    if nav:
        buttons.append(nav)
    buttons.append([Button.inline("⬅️ Back", cb("A", "back"))])
    if edit:
        return await event.edit(text, buttons=buttons)
    return await event.respond(text, buttons=buttons)

async def show_admin_stats(event, col_users, col_aliases, col_logs, count_cache):
    now = now_utc()
    ds = day_start_utc()
    total_users, active_users, pending, banned = await asyncio.gather(
        cached_count(col_users, {}, count_cache, "cnt:users:total"),
        cached_count(col_users, {"status": "active"}, count_cache, "cnt:users:active"),
        cached_count(col_users, {"status": "pending"}, count_cache, "cnt:users:pending"),
        cached_count(col_users, {"status": "banned"}, count_cache, "cnt:users:banned"),
    )
    total_aliases, active_aliases = await asyncio.gather(
        cached_count(col_aliases, {}, count_cache, "cnt:aliases:total"),
        cached_count(col_aliases, {"active": True, "expires_at": {"$gt": now}}, count_cache, "cnt:aliases:active2"),
    )
    total_mails, today_mails, deleted_mails, unread_mails = await asyncio.gather(
        cached_count(col_logs, {}, count_cache, "cnt:mails:total"),
        cached_count(col_logs, {"received_at": {"$gte": ds}}, count_cache, "cnt:mails:today", ttl=15),
        cached_count(col_logs, {"deleted": True}, count_cache, "cnt:mails:deleted"),
        cached_count(col_logs, {"read": {"$ne": True}, "deleted": {"$ne": True}}, count_cache, "cnt:mails:unread"),
    )
    text = (
        "📊 **System Statistics**\n━━━━━━━━━━━━━━━━━━━━\n\n"
        "👥 **Users:**\n"
        f" ├ Total: {total_users}\n"
        f" ├ Active: {active_users}\n"
        f" ├ Pending: {pending}\n"
        f" └ Banned: {banned}\n\n"
        "📧 **Emails:**\n"
        f" ├ Total: {total_aliases}\n"
        f" └ Active: {active_aliases}\n\n"
        "📨 **Mails:**\n"
        f" ├ Total: {total_mails}\n"
        f" ├ Today: {today_mails}\n"
        f" ├ Unread: {unread_mails}\n"
        f" └ Deleted: {deleted_mails}"
    )
    return await event.edit(text, buttons=[[Button.inline("⬅️ Back", cb("A", "back"))]])

async def show_user_list(event, col_users, col_aliases, status_filter, page=0):
    if status_filter == "admin":
        query = {"role": {"$in": ["admin", "moderator", "super_admin"]}}
    else:
        query = {"status": status_filter}
    total = await col_users.count_documents(query)
    users = await col_users.find(query).sort("created_at", -1).skip(page * ADMIN_PAGE_SIZE).limit(ADMIN_PAGE_SIZE + 1).to_list(ADMIN_PAGE_SIZE + 1)
    has_more = len(users) > ADMIN_PAGE_SIZE
    users = users[:ADMIN_PAGE_SIZE]
    label_map = {"active": "✅ Active", "pending": "⏳ Pending", "banned": "⛔ Banned", "admin": "👑 Admins"}
    title = label_map.get(status_filter, status_filter.title())
    total_pages = max(1, (total + ADMIN_PAGE_SIZE - 1) // ADMIN_PAGE_SIZE)
    text = f"👥 **{title} Users** — Page {page + 1}/{total_pages}\n━━━━━━━━━━━━━━━━━━━━\nTotal: {total}\n\n"
    buttons = []
    for u in users:
        name = u.get("name", "Unknown")
        uname = u.get("username", "")
        tg_id = u.get("tg_user_id", 0)
        role_icon = "👑" if u.get("role") in ["admin", "super_admin"] else "👤"
        alias_count = await col_aliases.count_documents({"tg_user_id": tg_id, "active": True})
        display = f"{role_icon} {short(name, 15)}"
        if uname:
            display += f" @{short(uname, 10)}"
        display += f" [{alias_count}📧]"
        text += f"{role_icon} **{short(name, 20)}**"
        if uname:
            text += f" (@{uname})"
        text += f"\n └ ID: `{tg_id}` | Emails: {alias_count}\n\n"
        buttons.append([Button.inline(display, cb("UM", "view", str(tg_id)))])
    if not users:
        text += "_No users found._"
    nav = []
    if page > 0:
        nav.append(Button.inline("⬅️ Prev", cb("UL", status_filter, str(page - 1))))
    if total > 0:
        nav.append(Button.inline(f"📄 {page + 1}/{total_pages}", cb("NOP")))
    if has_more:
        nav.append(Button.inline("Next ➡️", cb("UL", status_filter, str(page + 1))))
    if nav:
        buttons.append(nav)
    buttons.append([Button.inline("⬅️ Back", cb("A", "users"))])
    return await event.edit(text, buttons=buttons)

async def show_user_detail(event, tg_id, col_users, col_aliases, col_logs, user_cache):
    u = await cached_find_user(tg_id, col_users, user_cache)
    if not u:
        return await event.edit("❌ User not found.", buttons=[[Button.inline("⬅️ Back", cb("A", "users"))]])
    now = now_utc()
    active_aliases = await col_aliases.count_documents({"tg_user_id": tg_id, "active": True, "expires_at": {"$gt": now}})
    total_aliases  = await col_aliases.count_documents({"tg_user_id": tg_id})
    total_mails    = await col_logs.count_documents({"tg_user_id": tg_id, "deleted": {"$ne": True}})
    status = u.get("status", "unknown")
    role   = u.get("role", "user")
    status_icons = {"active": "✅", "pending": "⏳", "banned": "⛔"}
    role_icons   = {"super_admin": "🛡️", "admin": "👑", "moderator": "🔰", "user": "👤"}
    username_display = f"@{u.get('username')}" if u.get("username") else "Not set"
    text = (
        f"👤 **User Details**\n━━━━━━━━━━━━━━━━━━━━\n\n"
        f"📛 Name: **{u.get('name', 'Unknown')}**\n"
        f"🏷️ Username: **{username_display}**\n"
        f"🆔 ID: `{tg_id}`\n"
        f"📊 Status: {status_icons.get(status, '❓')} **{status.title()}**\n"
        f"🎖️ Role: {role_icons.get(role, '👤')} **{role.replace('_', ' ').title()}**\n"
        f"📅 Joined: {format_datetime(u.get('created_at'))}\n\n"
        f"📧 **Emails:**\n ├ Active: {active_aliases}\n └ Total: {total_aliases}\n\n"
        f"📨 **Mails:** {total_mails}"
    )
    return await event.edit(text, buttons=user_detail_kb(tg_id, status, role))

async def show_user_emails_admin(event, tg_id, col_users, col_aliases, col_logs, user_cache):
    now = now_utc()
    aliases = await col_aliases.find({"tg_user_id": tg_id}).sort("created_at", -1).to_list(50)
    u = await cached_find_user(tg_id, col_users, user_cache)
    uname = u.get("name", "Unknown") if u else "Unknown"
    text = f"📧 **Emails for {uname}**\n━━━━━━━━━━━━━━━━━━━━\n\n"
    buttons = []
    for a in aliases:
        exp_aware = make_aware(a.get("expires_at"))
        is_active = a.get("active") and exp_aware and exp_aware > now
        status_emoji = "✅" if is_active else "❌"
        mail_count = await col_logs.count_documents({"alias_email": a["alias_email"]})
        token = sha256(a["alias_email"])[:12]
        text += f"{status_emoji} `{a['alias_email']}`\n ├ Expires: {time_remaining(exp_aware)}\n └ Mails: {mail_count}\n\n"
        buttons.append([Button.inline(f"{status_emoji} {short(a['alias_email'], 30)}", cb("EA", token, "view"))])
    if not aliases:
        text += "_No emails assigned._"
    buttons.append([
        Button.inline("➕ Add Email", cb("UM", "addemail", str(tg_id))),
        Button.inline("⬅️ Back", cb("UM", "view", str(tg_id)))
    ])
    return await event.edit(text, buttons=buttons)

async def show_alias_list(event, col_users, col_aliases, list_type, user_cache, page=0):
    now = now_utc()
    if list_type == "active":
        query = {"active": True, "expires_at": {"$gt": now}}
    elif list_type == "expired":
        query = {"$or": [{"active": False}, {"expires_at": {"$lte": now}}]}
    else:
        query = {}
    total = await col_aliases.count_documents(query)
    aliases = await col_aliases.find(query).sort("created_at", -1).skip(page * ADMIN_PAGE_SIZE).limit(ADMIN_PAGE_SIZE + 1).to_list(ADMIN_PAGE_SIZE + 1)
    has_more = len(aliases) > ADMIN_PAGE_SIZE
    aliases = aliases[:ADMIN_PAGE_SIZE]
    total_pages = max(1, (total + ADMIN_PAGE_SIZE - 1) // ADMIN_PAGE_SIZE)
    label_map = {"active": "✅ Active", "expired": "❌ Expired", "all": "📋 All"}
    title = label_map.get(list_type, "All")
    text = f"📧 **{title} Emails** — Page {page + 1}/{total_pages}\n━━━━━━━━━━━━━━━━━━━━\nTotal: {total}\n\n"
    buttons = []
    for a in aliases:
        exp_aware = make_aware(a.get("expires_at"))
        is_active = a.get("active") and exp_aware and exp_aware > now
        status_emoji = "✅" if is_active else "❌"
        token = sha256(a["alias_email"])[:12]
        u = await cached_find_user(a.get("tg_user_id"), col_users, user_cache)
        uname = u.get("name", "?") if u else "?"
        text += f"{status_emoji} `{a['alias_email']}`\n ├ User: {short(uname, 15)} (`{a.get('tg_user_id')}`)\n └ Expires: {time_remaining(exp_aware)}\n\n"
        buttons.append([Button.inline(f"{status_emoji} {short(a['alias_email'], 30)}", cb("EA", token, "view"))])
    if not aliases:
        text += "_No emails found._"
    nav = []
    if page > 0:
        nav.append(Button.inline("⬅️ Prev", cb("EL", list_type, str(page - 1))))
    if total > 0:
        nav.append(Button.inline(f"📄 {page + 1}/{total_pages}", cb("NOP")))
    if has_more:
        nav.append(Button.inline("Next ➡️", cb("EL", list_type, str(page + 1))))
    if nav:
        buttons.append(nav)
    buttons.append([Button.inline("⬅️ Back", cb("A", "aliases"))])
    return await event.edit(text, buttons=buttons)

async def show_alias_detail(event, alias_email, col_users, col_aliases, col_logs, user_cache):
    alias = await col_aliases.find_one({"alias_email": alias_email})
    if not alias:
        return await event.edit("❌ Email not found.", buttons=[[Button.inline("⬅️ Back", cb("A", "aliases"))]])
    now = now_utc()
    exp_aware = make_aware(alias.get("expires_at"))
    is_active = alias.get("active") and exp_aware and exp_aware > now
    u = await cached_find_user(alias.get("tg_user_id"), col_users, user_cache)
    uname = u.get("name", "Unknown") if u else "Unknown"
    mail_count = await col_logs.count_documents({"alias_email": alias_email})
    token = sha256(alias_email)[:12]
    status = "✅ Active" if is_active else "❌ Inactive/Expired"
    text = (
        f"📧 **Email Details**\n━━━━━━━━━━━━━━━━━━━━\n\n"
        f"📧 Email: `{alias_email}`\n"
        f"📊 Status: **{status}**\n"
        f"👤 User: **{uname}** (`{alias.get('tg_user_id')}`)\n"
        f"📅 Created: {format_datetime(alias.get('created_at'))}\n"
        f"⏰ Expires: {format_datetime(exp_aware)}\n"
        f"⏳ Remaining: **{time_remaining(exp_aware)}**\n"
        f"📨 Total Mails: **{mail_count}**"
    )
    return await event.edit(text, buttons=alias_actions_kb(token, is_active))

async def show_admin_user_stats(event, tg_id, col_users, col_aliases, col_logs, user_cache):
    u = await cached_find_user(tg_id, col_users, user_cache)
    if not u:
        return await event.edit("❌ User not found.", buttons=[[Button.inline("⬅️ Back", cb("A", "users"))]])
    total_aliases  = await col_aliases.count_documents({"tg_user_id": tg_id})
    active_aliases = await col_aliases.count_documents({"tg_user_id": tg_id, "active": True, "expires_at": {"$gt": now_utc()}})
    total_mails    = await col_logs.count_documents({"tg_user_id": tg_id, "deleted": {"$ne": True}})
    today_mails    = await col_logs.count_documents({"tg_user_id": tg_id, "received_at": {"$gte": day_start_utc()}})
    text = (
        f"📊 **Stats: {u.get('name', 'Unknown')}**\n━━━━━━━━━━━━━━━━━━━━\n\n"
        f"📧 Emails: {active_aliases}/{total_aliases} active\n"
        f"📨 Mails: {total_mails} total\n"
        f"📅 Today: {today_mails}\n"
        f"📅 Joined: {format_datetime(u.get('created_at'))}"
    )
    return await event.edit(text, buttons=[[Button.inline("⬅️ Back", cb("UM", "view", str(tg_id)))]])

async def show_admin_user_inbox(event, tg_id, col_users, col_logs, user_cache, page=0):
    logs = await col_logs.find({
        "tg_user_id": tg_id, "deleted": {"$ne": True}
    }).sort("received_at", -1).skip(page * ADMIN_PAGE_SIZE).limit(ADMIN_PAGE_SIZE + 1).to_list(ADMIN_PAGE_SIZE + 1)
    has_more = len(logs) > ADMIN_PAGE_SIZE
    logs = logs[:ADMIN_PAGE_SIZE]
    u = await cached_find_user(tg_id, col_users, user_cache)
    uname = u.get("name", "Unknown") if u else "Unknown"
    text = f"📥 **Inbox: {uname}** — Page {page + 1}\n━━━━━━━━━━━━━━━━━━━━\n\n"
    buttons = []
    for lg in logs:
        log_id = lg["_id"][:20]
        subject_clean = short(lg.get('subject', 'No subject'), 28)
        text += f"📩 {subject_clean}\n └ {format_datetime(lg.get('received_at'))}\n\n"
        buttons.append([Button.inline(f"📩 {short(subject_clean, 28)}", cb("ML", log_id))])
    if not logs:
        text += "_No mails._"
    nav = []
    if page > 0:
        nav.append(Button.inline("⬅️ Prev", cb("UM", "inbox", str(tg_id), str(page - 1))))
    if has_more:
        nav.append(Button.inline("Next ➡️", cb("UM", "inbox", str(tg_id), str(page + 1))))
    if nav:
        buttons.append(nav)
    buttons.append([Button.inline("⬅️ Back", cb("UM", "view", str(tg_id)))])
    return await event.edit(text, buttons=buttons)

async def show_user_overview(event, col_users, count_cache):
    total, active, pending, banned, admins = await asyncio.gather(
        cached_count(col_users, {}, count_cache, "cnt:users:total"),
        cached_count(col_users, {"status": "active"}, count_cache, "cnt:users:active"),
        cached_count(col_users, {"status": "pending"}, count_cache, "cnt:users:pending"),
        cached_count(col_users, {"status": "banned"}, count_cache, "cnt:users:banned"),
        cached_count(col_users, {"role": {"$in": ["admin", "super_admin"]}}, count_cache, "cnt:users:admins"),
    )
    text = (
        "📊 **User Overview**\n━━━━━━━━━━━━━━━━━━━━\n\n"
        f"👥 Total: **{total}**\n"
        f"✅ Active: **{active}**\n"
        f"⏳ Pending: **{pending}**\n"
        f"⛔ Banned: **{banned}**\n"
        f"👑 Admins: **{admins}**"
    )
    return await event.edit(text, buttons=[[Button.inline("⬅️ Back", cb("A", "users"))]])

async def show_email_overview(event, col_aliases, count_cache):
    now = now_utc()
    total  = await cached_count(col_aliases, {}, count_cache, "cnt:aliases:total")
    active = await cached_count(col_aliases, {"active": True, "expires_at": {"$gt": now}}, count_cache, "cnt:aliases:active2")
    expired = await cached_count(col_aliases, {"$or": [{"active": False}, {"expires_at": {"$lte": now}}]}, count_cache, "cnt:aliases:expired")
    expiring_soon = await col_aliases.count_documents({
        "active": True, "expires_at": {"$gt": now, "$lte": now + timedelta(days=7)}
    })
    text = (
        "📊 **Email Overview**\n━━━━━━━━━━━━━━━━━━━━\n\n"
        f"📧 Total: **{total}**\n"
        f"✅ Active: **{active}**\n"
        f"❌ Expired: **{expired}**\n"
        f"⚠️ Expiring in 7 days: **{expiring_soon}**"
    )
    return await event.edit(text, buttons=[[Button.inline("⬅️ Back", cb("A", "aliases"))]])

async def show_activity_log(event, col_users, col_logs):
    recent_users = await col_users.find().sort("updated_at", -1).limit(5).to_list(5)
    recent_mails = await col_logs.find().sort("received_at", -1).limit(5).to_list(5)
    text = "📋 **Recent Activity**\n━━━━━━━━━━━━━━━━━━━━\n\n**Latest Users:**\n"
    for u in recent_users:
        text += f" • {short(u.get('name', '?'), 15)} — {u.get('status', '?')} — {format_datetime(u.get('updated_at'))}\n"
    text += "\n**Latest Mails:**\n"
    for lg in recent_mails:
        text += f" • {short(lg.get('subject', '?'), 25)} → `{short(lg.get('alias_email', '?'), 20)}`\n   {format_datetime(lg.get('received_at'))}\n"
    return await event.edit(text, buttons=[[Button.inline("⬅️ Back", cb("A", "back"))]])

async def do_broadcast(bot_instance, col_users, text_msg, entities, message_obj, target_type):
    sent = failed = 0
    query = {"status": "active"} if target_type == "active" else {}
    async for u in col_users.find(query):
        tg = u.get("tg_user_id")
        if not tg:
            continue
        try:
            if message_obj and getattr(message_obj, "media", None):
                await bot_instance.send_file(tg, message_obj.media, caption=text_msg or None, formatting_entities=entities or None)
            else:
                await bot_instance.send_message(tg, text_msg, formatting_entities=entities)
            sent += 1
            await asyncio.sleep(0.05)
        except Exception:
            failed += 1
    return sent, failed

async def finalize_add_email(admin_tg_id, event, days, bot_instance, col_aliases, alias_cache, alias_token_cache_dict, admin_state, count_cache):
    st = admin_state.get(admin_tg_id)
    if not st:
        return
    alias_email = st["payload"]["alias_email"]
    user_id     = st["payload"].get("user_id", "")
    target_tg   = int(st["payload"]["target_tg"])
    expires_at  = now_utc() + timedelta(days=days)

    if email_exists_in_other_bot(alias_email, bot_instance):
        admin_state.pop(admin_tg_id, None)
        return await event.reply(
            f"❌ **Email Conflict!**\n\n`{alias_email}` is already assigned in the **other bot**.\n"
            "Each email can only exist in one bot at a time.",
            buttons=[[Button.inline("⬅️ Back", cb("A", "aliases"))]]
        )

    await col_aliases.update_one(
        {"alias_email": alias_email},
        {"$set": {
            "alias_email": alias_email,
            "user_id": user_id or f"U{target_tg}",
            "tg_user_id": target_tg,
            "active": True,
            "created_at": now_utc(),
            "updated_at": now_utc(),
            "expires_at": expires_at,
            "created_by": admin_tg_id
        }},
        upsert=True
    )
    admin_state.pop(admin_tg_id, None)
    alias_cache["by_email"][alias_email] = {
        "user_id": user_id or f"U{target_tg}",
        "tg_user_id": target_tg,
        "expires_at": expires_at
    }
    alias_cache["all_emails"].add(alias_email)
    token = sha256(alias_email)[:12]
    alias_token_cache_dict[token] = alias_email
    count_cache.clear()
    try:
        await bot_instance.send_message(
            target_tg,
            f"✅ **New Email Assigned!**\n━━━━━━━━━━━━━━━━━━━━\n\n"
            f"📧 Email: `{alias_email}`\n"
            f"⏰ Expires: {format_datetime(expires_at)}\n"
            f"⏳ Duration: {days} days\n\n"
            "You'll receive mails sent to this address.",
            buttons=[[Button.inline("📧 View My Emails", cb("M", "emails"))]]
        )
    except Exception:
        pass
    await event.reply(
        f"✅ **Email Created**\n━━━━━━━━━━━━━━━━━━━━\n\n"
        f"📧 Email: `{alias_email}`\n"
        f"👤 User: `{target_tg}`\n"
        f"📅 Duration: **{days} days**\n"
        f"⏰ Expires: {format_datetime(expires_at)}",
        buttons=[
            [Button.inline("➕ Add Another", cb("UM", "addemail", str(target_tg))),
             Button.inline("👤 View User", cb("UM", "view", str(target_tg)))],
            [Button.inline("⬅️ Dashboard", cb("A", "back"))]
        ]
    )


# =====================================================================
# PROCESS EMAIL  (SMTP handler) — sends to ALL admins on fallback
# =====================================================================
async def process_incoming_email(rcpt_to: str, raw_data: bytes):
    try:
        msg = email.message_from_bytes(raw_data)
        to_addr = rcpt_to.lower().strip()

        for (bot_instance, col_aliases, col_users, col_logs, alias_cache,
             super_admin_ids, user_cache, bot_label) in [
            (bot1, bot1_col_aliases, bot1_col_users, bot1_col_logs, bot1_alias_cache,
             BOT1_SUPER_ADMIN_IDS, bot1_user_cache, "Bot1"),
            (bot2, bot2_col_aliases, bot2_col_users, bot2_col_logs, bot2_alias_cache,
             BOT2_SUPER_ADMIN_IDS, bot2_user_cache, "Bot2"),
        ]:
            if to_addr in alias_cache["by_email"]:
                await _deliver_email(bot_instance, col_aliases, col_users, col_logs,
                                     alias_cache, super_admin_ids, user_cache, bot_label,
                                     msg, raw_data, to_addr)
                return

        logger.warning(f"[SMTP] No alias found for {to_addr}, routing to ALL admins (Bot1+Bot2)")
        await _admin_fallback_all_bots(msg, to_addr, "unassigned")
    except Exception as e:
        logger.error(f"[SMTP] Error processing email for {rcpt_to}: {e}")

async def _deliver_email(bot_instance, col_aliases, col_users, col_logs,
                          alias_cache, super_admin_ids, user_cache, bot_label,
                          msg, raw_data, matched_alias):
    route      = alias_cache["by_email"][matched_alias]
    tg_user_id = int(route["tg_user_id"])
    user = await cached_find_user(tg_user_id, col_users, user_cache)
    subject     = decode_str(msg.get("Subject", ""))
    sender      = decode_str(msg.get("From", ""))
    date_hdr    = decode_str(msg.get("Date", ""))
    body        = get_text_body(msg)
    clean_prev  = clean_html_body(body, 900)
    msg_id      = decode_str(msg.get("Message-ID", "")) or ""
    dedupe_key  = sha256(f"{msg_id}|{matched_alias}|{subject}|{sender}")

    if not user or user.get("status") != "active":
        await _admin_fallback_email(bot_instance, col_logs, super_admin_ids,
                                    msg, matched_alias, matched_alias, "user_inactive",
                                    sender=sender, subject=subject, body=body,
                                    clean_preview=clean_prev, dedupe_key=dedupe_key)
        return

    log_doc = {
        "_id": dedupe_key, "dedupe_key": dedupe_key,
        "alias_email": matched_alias, "original_to": matched_alias,
        "tg_user_id": tg_user_id, "from": sender, "subject": subject,
        "date_header": date_hdr, "received_at": now_utc(),
        "snippet": short(clean_prev, 220), "body": body,
        "read": False, "deleted": False, "starred": False, "bot": bot_label,
    }
    try:
        await col_logs.insert_one(log_doc)
    except Exception:
        return

    notify = user.get("notifications", True)
    if notify:
        text = (
            "🔔 **New Mail Received**\n━━━━━━━━━━━━━━━━━━━━\n\n"
            f"👤 **From:** `{short(sender, 40)}`\n"
            f"📂 **Subject:** **{short(subject, 60)}**\n"
            f"📧 **To:** `{matched_alias}`\n\n"
            f"**Preview:**\n{short(clean_prev, 250)}"
        )
        try:
            await bot_instance.send_message(
                tg_user_id, text,
                buttons=[
                    [Button.inline("📖 Read Full Mail", cb("ML", dedupe_key[:20]))],
                    [Button.inline("📥 Go to Inbox", cb("M", "inbox", "0"))]
                ]
            )
        except Exception:
            pass

async def _admin_fallback_all_bots(msg, alias_email, reason,
                                    sender=None, subject=None, body=None,
                                    clean_preview=None, dedupe_key=None):
    for (bot_instance, col_logs, super_admin_ids) in [
        (bot1, bot1_col_logs, BOT1_SUPER_ADMIN_IDS),
        (bot2, bot2_col_logs, BOT2_SUPER_ADMIN_IDS),
    ]:
        await _admin_fallback_email(
            bot_instance, col_logs, super_admin_ids,
            msg, alias_email, alias_email, reason,
            sender=sender, subject=subject, body=body,
            clean_preview=clean_preview, dedupe_key=dedupe_key
        )

async def _admin_fallback_email(bot_instance, col_logs, super_admin_ids,
                                 msg, alias_email, original_to, reason,
                                 sender=None, subject=None, body=None,
                                 clean_preview=None, dedupe_key=None):
    if not super_admin_ids:
        return
    if sender is None:
        sender = decode_str(msg.get("From", ""))
    if subject is None:
        subject = decode_str(msg.get("Subject", ""))
    if body is None:
        body = get_text_body(msg)
    if clean_preview is None:
        clean_preview = clean_html_body(body, 900)

    reason_labels = {
        "unassigned": "📭 Unassigned Email",
        "expired": "⏰ Expired Alias",
        "user_inactive": "🚫 Inactive User"
    }
    reason_label = reason_labels.get(reason, "📭 Unmatched Email")
    text = (
        f"🛡️ **{reason_label}**\n━━━━━━━━━━━━━━━━━━━━\n\n"
        f"👤 **From:** `{short(sender, 40)}`\n"
        f"📂 **Subject:** **{short(subject, 60)}**\n"
        f"📧 **To:** `{original_to or alias_email or 'Unknown'}`\n\n"
        f"**Preview:**\n{short(clean_preview, 250)}"
    )

    for admin_tg in super_admin_ids:
        if dedupe_key is None:
            msg_id = decode_str(msg.get("Message-ID", "")) or ""
            this_dedupe = sha256(f"{msg_id}|{alias_email}|{subject}|{sender}|fallback|{admin_tg}")
        else:
            this_dedupe = sha256(f"{dedupe_key}|{admin_tg}")

        log_doc = {
            "_id": this_dedupe, "dedupe_key": this_dedupe,
            "alias_email": alias_email or original_to or "unknown",
            "original_to": original_to or alias_email or "unknown",
            "tg_user_id": admin_tg, "from": sender, "subject": subject,
            "date_header": decode_str(msg.get("Date", "")),
            "received_at": now_utc(), "snippet": short(clean_preview, 220),
            "body": body, "read": False, "deleted": False, "starred": False,
            "admin_fallback": True, "fallback_reason": reason,
        }
        try:
            await col_logs.insert_one(log_doc)
        except Exception:
            pass

        try:
            await bot_instance.send_message(
                admin_tg, text,
                buttons=[
                    [Button.inline("📖 Read Full Mail", cb("ML", this_dedupe[:20]))],
                    [Button.inline("🛡️ Admin Inbox", cb("A", "admin_inbox", "0"))]
                ]
            )
        except Exception:
            pass


# =====================================================================
# SMTP HANDLER
# =====================================================================
class MasterSMTPHandler:
    async def handle_DATA(self, server, session, envelope):
        try:
            raw_data = envelope.content
            for rcpt in envelope.rcpt_tos:
                await process_incoming_email(rcpt, raw_data)
        except Exception as e:
            logger.error(f"[SMTP] handle_DATA error: {e}")
        return '250 Message accepted for delivery'


# =====================================================================
# CALLBACK HANDLER FACTORY
# =====================================================================
def make_callback_handler(
    bot_instance, col_users, col_aliases, col_logs,
    alias_cache, alias_token_cache_dict,
    admin_state, super_admin_ids,
    refresh_cache_fn, refresh_tokens_fn,
    user_cache, count_cache,
):
    async def on_callback(event):
        data = event.data.decode("utf-8", errors="replace")
        parts = data.split("|")

        async def _is_admin():
            return await is_admin(event.sender_id, col_users, super_admin_ids, user_cache)
        async def _check_access():
            return await check_user_access(event.sender_id, col_users, user_cache)

        if parts[0] == "NOP":
            return await event.answer()

        if parts[0] == "CS":
            has_access, status = await _check_access()
            if has_access:
                await event.answer("✅ Access granted!", alert=True)
                return await user_panel(event, col_users, col_aliases, col_logs, user_cache, count_cache, edit=True)
            msg_map = {"pending": "⏳ Still pending...", "banned": "⛔ Banned", "not_registered": "❌ Not registered"}
            return await event.answer(msg_map.get(status, "❓ Unknown"), alert=True)

        if parts[0] == "X":
            admin_state.pop(event.sender_id, None)
            if await _is_admin():
                return await admin_panel(event, bot_instance, col_users, col_aliases, col_logs, count_cache, edit=True)
            return await user_panel(event, col_users, col_aliases, col_logs, user_cache, count_cache, edit=True)

        if parts[0] == "A":
            if not await _is_admin():
                return await event.answer("❌ Admin only", alert=True)
            action = parts[1] if len(parts) > 1 else "back"
            if action == "back":
                return await admin_panel(event, bot_instance, col_users, col_aliases, col_logs, count_cache, edit=True)
            elif action == "users":
                return await event.edit("👥 **User Management**\n━━━━━━━━━━━━━━━━━━━━\n\nSelect an option:", buttons=users_management_kb())
            elif action == "aliases":
                return await event.edit("📧 **Email Management**\n━━━━━━━━━━━━━━━━━━━━\n\nManage email aliases:", buttons=aliases_kb())
            elif action == "stats":
                return await show_admin_stats(event, col_users, col_aliases, col_logs, count_cache)
            elif action == "broadcast":
                target = parts[2] if len(parts) > 2 else None
                if target:
                    admin_state[event.sender_id] = {"stage": "broadcast_wait_text", "payload": {"target_type": target}}
                    t_str = "All Users" if target == "all" else "Active Users Only"
                    return await event.edit(
                        f"📢 **Broadcast to: {t_str}**\n\nSend your message now.\nSupports text, photos, and formatting.",
                        buttons=[[Button.inline("❌ Cancel", cb("X", "cancel"))]]
                    )
                return await event.edit(
                    "📢 **Broadcast Message**\n━━━━━━━━━━━━━━━━━━━━\n\nSelect target audience:",
                    buttons=[
                        [Button.inline("📢 All Users", cb("A", "broadcast", "all")),
                         Button.inline("📢 Active Only", cb("A", "broadcast", "active"))],
                        [Button.inline("⬅️ Back", cb("A", "back"))]
                    ]
                )
            elif action == "settings":
                return await event.edit("🔧 **System Settings**\n━━━━━━━━━━━━━━━━━━━━", buttons=settings_kb())
            elif action == "admin_inbox":
                page = int(parts[2]) if len(parts) > 2 else 0
                return await show_admin_inbox(event, col_logs, super_admin_ids, page=page, edit=True)
            elif action == "activity":
                return await show_activity_log(event, col_users, col_logs)
            elif action == "refresh":
                await refresh_cache_fn(force=True)
                await refresh_tokens_fn(force=True)
                user_cache.clear()
                count_cache.clear()
                return await event.answer("✅ All caches refreshed!", alert=True)
            elif action == "dbclean":
                deleted_count = (await col_logs.delete_many({"deleted": True})).deleted_count
                expired_count = (await col_aliases.delete_many({
                    "active": False, "expires_at": {"$lt": now_utc() - timedelta(days=90)}
                })).deleted_count
                count_cache.clear()
                return await event.answer(f"✅ Cleaned {deleted_count} deleted mails, {expired_count} old aliases", alert=True)
            return

        if parts[0] == "AI":
            if not await _is_admin():
                return await event.answer("❌ Admin only", alert=True)
            page = int(parts[1]) if len(parts) > 1 else 0
            return await show_admin_inbox(event, col_logs, super_admin_ids, page=page, edit=True)

        if parts[0] == "U":
            if not await _is_admin():
                return await event.answer("❌ Admin only", alert=True)
            action = parts[1] if len(parts) > 1 else ""
            if action == "add":
                admin_state[event.sender_id] = {"stage": "add_user_wait_id", "payload": {}}
                return await event.edit(
                    "➕ **Add New User**\n━━━━━━━━━━━━━━━━━━━━\n\n"
                    "Send one of the following:\n • User's Telegram **ID** (number)\n • User's **@username**\n • **Forward** a message from the user",
                    buttons=[[Button.inline("❌ Cancel", cb("X", "cancel"))]]
                )
            elif action == "search":
                admin_state[event.sender_id] = {"stage": "search_user", "payload": {}}
                return await event.edit(
                    "🔍 **Search User**\n━━━━━━━━━━━━━━━━━━━━\n\nSend user ID, @username, or name:",
                    buttons=[[Button.inline("❌ Cancel", cb("X", "cancel"))]]
                )
            elif action == "list":
                status_filter = parts[2] if len(parts) > 2 else "active"
                page = int(parts[3]) if len(parts) > 3 else 0
                return await show_user_list(event, col_users, col_aliases, status_filter, page)
            elif action == "overview":
                return await show_user_overview(event, col_users, count_cache)
            return

        if parts[0] == "UL":
            if not await _is_admin():
                return await event.answer("❌ Admin only", alert=True)
            return await show_user_list(event, col_users, col_aliases,
                                        parts[1] if len(parts) > 1 else "active",
                                        int(parts[2]) if len(parts) > 2 else 0)

        if parts[0] == "UM":
            if not await _is_admin():
                return await event.answer("❌ Admin only", alert=True)
            action = parts[1] if len(parts) > 1 else ""
            tg_id  = int(parts[2]) if len(parts) > 2 else 0
            if action == "view":
                return await show_user_detail(event, tg_id, col_users, col_aliases, col_logs, user_cache)
            elif action == "approve":
                await col_users.update_one({"tg_user_id": tg_id}, {"$set": {"status": "active", "updated_at": now_utc()}})
                await invalidate_user(tg_id, user_cache)
                count_cache.clear()
                try:
                    await bot_instance.send_message(tg_id, "✅ **Access Granted!**\n\nYour account has been approved.\nUse /start to begin.", buttons=[[Button.inline("🚀 Start", cb("M", "back"))]])
                except Exception:
                    pass
                await event.answer("✅ User approved!", alert=True)
                return await show_user_detail(event, tg_id, col_users, col_aliases, col_logs, user_cache)
            elif action == "reject":
                await col_users.update_one({"tg_user_id": tg_id}, {"$set": {"status": "banned", "updated_at": now_utc()}})
                await invalidate_user(tg_id, user_cache)
                count_cache.clear()
                try:
                    await bot_instance.send_message(tg_id, "❌ **Access Denied**\n\nYour access request was rejected.")
                except Exception:
                    pass
                await event.answer("❌ User rejected", alert=True)
                return await show_user_detail(event, tg_id, col_users, col_aliases, col_logs, user_cache)
            elif action == "ban":
                await col_users.update_one({"tg_user_id": tg_id}, {"$set": {"status": "banned", "updated_at": now_utc()}})
                await invalidate_user(tg_id, user_cache)
                try:
                    await bot_instance.send_message(tg_id, "⛔ **Account Banned**\n\nYour account has been banned by admin.")
                except Exception:
                    pass
                await event.answer("⛔ User banned", alert=True)
                return await show_user_detail(event, tg_id, col_users, col_aliases, col_logs, user_cache)
            elif action == "unban":
                await col_users.update_one({"tg_user_id": tg_id}, {"$set": {"status": "active", "updated_at": now_utc()}})
                await invalidate_user(tg_id, user_cache)
                try:
                    await bot_instance.send_message(tg_id, "✅ **Account Unbanned**\n\nYour access has been restored. Use /start.")
                except Exception:
                    pass
                await event.answer("✅ User unbanned", alert=True)
                return await show_user_detail(event, tg_id, col_users, col_aliases, col_logs, user_cache)
            elif action == "mkadmin":
                target = await cached_find_user(tg_id, col_users, user_cache)
                if target and tg_id not in super_admin_ids:
                    await col_users.update_one({"tg_user_id": tg_id}, {"$set": {"role": "admin", "updated_at": now_utc()}})
                    await invalidate_user(tg_id, user_cache)
                    try:
                        await bot_instance.send_message(tg_id, "👑 **Admin Access Granted**\n\nYou now have admin privileges.")
                    except Exception:
                        pass
                await event.answer("👑 Admin role granted", alert=True)
                return await show_user_detail(event, tg_id, col_users, col_aliases, col_logs, user_cache)
            elif action == "rmadmin":
                if tg_id not in super_admin_ids:
                    await col_users.update_one({"tg_user_id": tg_id}, {"$set": {"role": "user", "updated_at": now_utc()}})
                    await invalidate_user(tg_id, user_cache)
                await event.answer("👤 Admin role removed", alert=True)
                return await show_user_detail(event, tg_id, col_users, col_aliases, col_logs, user_cache)
            elif action == "emails":
                return await show_user_emails_admin(event, tg_id, col_users, col_aliases, col_logs, user_cache)
            elif action == "addemail":
                admin_state[event.sender_id] = {
                    "stage": "add_email_wait_email",
                    "payload": {"target_tg": tg_id, "user_id": f"U{tg_id}"}
                }
                u = await cached_find_user(tg_id, col_users, user_cache)
                uname = u.get("name", "Unknown") if u else "Unknown"
                return await event.edit(
                    f"➕ **Add Email for {uname}**\nUser ID: `{tg_id}`\n━━━━━━━━━━━━━━━━━━━━\n\n"
                    "Send the email address to assign:\nExample: `user@yourdomain.com`",
                    buttons=[[Button.inline("❌ Cancel", cb("X", "cancel"))]]
                )
            elif action == "stats":
                return await show_admin_user_stats(event, tg_id, col_users, col_aliases, col_logs, user_cache)
            elif action == "inbox":
                page = int(parts[3]) if len(parts) > 3 else 0
                return await show_admin_user_inbox(event, tg_id, col_users, col_logs, user_cache, page)
            elif action == "delconfirm":
                u = await cached_find_user(tg_id, col_users, user_cache)
                uname = u.get("name", "Unknown") if u else "Unknown"
                return await event.edit(
                    f"⚠️ **Delete User: {uname}**\n\nID: `{tg_id}`\n\n"
                    "This will:\n• Remove user account\n• Deactivate all their emails\n\n**This cannot be undone!**",
                    buttons=[
                        [Button.inline("🗑️ Confirm Delete", cb("UM", "delyes", str(tg_id)))],
                        [Button.inline("❌ Cancel", cb("UM", "view", str(tg_id)))]
                    ]
                )
            elif action == "delyes":
                await col_aliases.update_many({"tg_user_id": tg_id}, {"$set": {"active": False}})
                await col_users.delete_one({"tg_user_id": tg_id})
                await invalidate_user(tg_id, user_cache)
                count_cache.clear()
                await refresh_cache_fn(force=True)
                await event.answer("🗑️ User deleted", alert=True)
                return await event.edit("✅ User deleted.", buttons=[[Button.inline("⬅️ Back", cb("A", "users"))]])
            return

        if parts[0] == "E":
            if not await _is_admin():
                return await event.answer("❌ Admin only", alert=True)
            action = parts[1] if len(parts) > 1 else ""
            if action == "add":
                admin_state[event.sender_id] = {"stage": "add_email_pick_user", "payload": {}}
                return await event.edit(
                    "➕ **Create Email Alias**\n━━━━━━━━━━━━━━━━━━━━\n\n"
                    "Send the target user's:\n • Telegram **ID** (number)\n • **@username**\n\nThe email will be assigned to this user.",
                    buttons=[[Button.inline("❌ Cancel", cb("X", "cancel"))]]
                )
            elif action == "search":
                admin_state[event.sender_id] = {"stage": "search_email", "payload": {}}
                return await event.edit(
                    "🔍 **Search Email**\n━━━━━━━━━━━━━━━━━━━━\n\nSend the email address to search:",
                    buttons=[[Button.inline("❌ Cancel", cb("X", "cancel"))]]
                )
            elif action == "list":
                list_type = parts[2] if len(parts) > 2 else "active"
                page      = int(parts[3]) if len(parts) > 3 else 0
                return await show_alias_list(event, col_users, col_aliases, list_type, user_cache, page)
            elif action == "overview":
                return await show_email_overview(event, col_aliases, count_cache)
            elif action == "cleanup":
                count = await col_aliases.update_many(
                    {"expires_at": {"$lte": now_utc()}, "active": True},
                    {"$set": {"active": False}}
                )
                await refresh_cache_fn(force=True)
                count_cache.clear()
                return await event.answer(f"✅ Deactivated {count.modified_count} expired emails", alert=True)
            return

        if parts[0] == "EL":
            if not await _is_admin():
                return await event.answer("❌ Admin only", alert=True)
            return await show_alias_list(event, col_users, col_aliases,
                                         parts[1] if len(parts) > 1 else "active",
                                         user_cache,
                                         int(parts[2]) if len(parts) > 2 else 0)

        if parts[0] == "EA":
            if not await _is_admin():
                return await event.answer("❌ Admin only", alert=True)
            await refresh_tokens_fn(force=True)
            token      = parts[1] if len(parts) > 1 else ""
            action_val = parts[2] if len(parts) > 2 else ""
            if action_val == "view":
                ae = alias_token_cache_dict.get(token)
                if not ae:
                    return await event.answer("❌ Email not found", alert=True)
                return await show_alias_detail(event, ae, col_users, col_aliases, col_logs, user_cache)
            if action_val == "reassign":
                ae = alias_token_cache_dict.get(token)
                if not ae:
                    return await event.answer("❌ Email not found", alert=True)
                admin_state[event.sender_id] = {
                    "stage": "reassign_email_wait_user",
                    "payload": {"alias_email": ae, "token": token}
                }
                return await event.edit(
                    f"🔄 **Reassign Email**\n\nEmail: `{ae}`\n\nSend new user's ID or @username:",
                    buttons=[[Button.inline("❌ Cancel", cb("X", "cancel"))]]
                )
            if action_val and action_val.isdigit():
                days = int(action_val)
                ae = alias_token_cache_dict.get(token)
                if not ae:
                    return await event.answer("❌ Email not found", alert=True)
                alias = await col_aliases.find_one({"alias_email": ae})
                if not alias:
                    return await event.answer("❌ Alias not found", alert=True)
                current_exp = make_aware(alias.get("expires_at")) or now_utc()
                if current_exp < now_utc():
                    current_exp = now_utc()
                new_exp = current_exp + timedelta(days=days)
                await col_aliases.update_one(
                    {"alias_email": ae},
                    {"$set": {"expires_at": new_exp, "active": True, "updated_at": now_utc()}}
                )
                await refresh_cache_fn(force=True)
                count_cache.clear()
                await event.answer(f"✅ Extended by {days} days", alert=True)
                return await show_alias_detail(event, ae, col_users, col_aliases, col_logs, user_cache)
            return

        if parts[0] == "ED":
            if not await _is_admin():
                return await event.answer("❌ Admin only", alert=True)
            await refresh_tokens_fn(force=True)
            token = parts[1] if len(parts) > 1 else ""
            ae = alias_token_cache_dict.get(token)
            if not ae:
                return await event.answer("❌ Email not found", alert=True)
            await col_aliases.update_one({"alias_email": ae}, {"$set": {"active": False, "updated_at": now_utc()}})
            await refresh_cache_fn(force=True)
            count_cache.clear()
            await event.answer("✅ Email deactivated", alert=True)
            return await show_alias_detail(event, ae, col_users, col_aliases, col_logs, user_cache)

        if parts[0] == "ER":
            if not await _is_admin():
                return await event.answer("❌ Admin only", alert=True)
            await refresh_tokens_fn(force=True)
            token = parts[1] if len(parts) > 1 else ""
            days  = int(parts[2]) if len(parts) > 2 and parts[2].isdigit() else 30
            ae = alias_token_cache_dict.get(token)
            if not ae:
                return await event.answer("❌ Email not found", alert=True)
            new_exp = now_utc() + timedelta(days=days)
            await col_aliases.update_one(
                {"alias_email": ae},
                {"$set": {"active": True, "expires_at": new_exp, "updated_at": now_utc()}}
            )
            await refresh_cache_fn(force=True)
            count_cache.clear()
            await event.answer(f"✅ Reactivated for {days} days", alert=True)
            return await show_alias_detail(event, ae, col_users, col_aliases, col_logs, user_cache)

        if parts[0] == "EP":
            if not await _is_admin():
                return await event.answer("❌ Admin only", alert=True)
            await refresh_tokens_fn(force=True)
            token = parts[1] if len(parts) > 1 else ""
            ae = alias_token_cache_dict.get(token)
            if not ae:
                return await event.answer("❌ Email not found", alert=True)
            await col_aliases.delete_one({"alias_email": ae})
            await refresh_cache_fn(force=True)
            await refresh_tokens_fn(force=True)
            count_cache.clear()
            await event.answer("🗑️ Email permanently deleted", alert=True)
            return await event.edit("✅ Email deleted.", buttons=[[Button.inline("⬅️ Back", cb("A", "aliases"))]])

        if parts[0] == "D":
            st = admin_state.get(event.sender_id)
            if not st:
                return await event.answer("❌ No pending action", alert=True)
            val = parts[1] if len(parts) > 1 else ""
            if val == "custom":
                st["stage"] = "add_email_wait_custom_days"
                admin_state[event.sender_id] = st
                return await event.edit(
                    "✏️ **Custom Duration**\n\nEnter number of days (1-3650):",
                    buttons=[[Button.inline("❌ Cancel", cb("X", "cancel"))]]
                )
            if val.isdigit():
                return await finalize_add_email(
                    event.sender_id, event, int(val),
                    bot_instance, col_aliases, alias_cache, alias_token_cache_dict, admin_state, count_cache
                )
            return

        if parts[0] == "BC":
            if parts[1] == "send":
                if not await _is_admin():
                    return await event.answer("❌ Admin access required", alert=True)
                st = admin_state.get(event.sender_id)
                if not st or st.get("stage") != "broadcast_confirm":
                    return await event.answer("❌ No pending broadcast", alert=True)
                text_msg    = st["payload"]["text"]
                entities    = st["payload"].get("entities", [])
                message_obj = st["payload"].get("message_obj")
                target_type = st["payload"].get("target_type", "active")
                admin_state.pop(event.sender_id, None)
                await event.edit("📢 Sending broadcast... Please wait.")
                sent, failed = await do_broadcast(bot_instance, col_users, text_msg, entities, message_obj, target_type)
                return await event.respond(
                    f"✅ Broadcast Complete\n━━━━━━━━━━━━━━━━━━━━\n\n📤 Sent: {sent}\n❌ Failed: {failed}",
                    buttons=[[Button.inline("⬅️ Dashboard", cb("A", "back"))]]
                )
            return

        if parts[0] == "M":
            has_access, _ = await _check_access()
            if not has_access:
                return await event.answer("❌ Access denied", alert=True)
            action = parts[1] if len(parts) > 1 else "back"
            if action == "back":
                if await _is_admin():
                    return await admin_panel(event, bot_instance, col_users, col_aliases, col_logs, count_cache, edit=True)
                return await user_panel(event, col_users, col_aliases, col_logs, user_cache, count_cache, edit=True)
            elif action == "inbox":
                page = int(parts[2]) if len(parts) > 2 else 0
                return await show_inbox(event, col_logs, page=page, edit=True)
            elif action == "emails":
                return await show_user_emails(event, col_aliases, col_logs, edit=True)
            elif action == "stats":
                return await show_user_stats(event, col_users, col_aliases, col_logs, user_cache, edit=True)
            elif action == "settings":
                return await show_user_settings(event, col_users, user_cache, edit=True)
            elif action == "help":
                return await show_user_help(event, edit=True)
            elif action == "starred":
                page = int(parts[2]) if len(parts) > 2 else 0
                return await show_starred(event, col_logs, page=page, edit=True)
            return

        if parts[0] == "MI":
            return await show_inbox(event, col_logs, page=int(parts[1]) if len(parts) > 1 else 0, edit=True)
        if parts[0] == "MST":
            return await show_starred(event, col_logs, page=int(parts[1]) if len(parts) > 1 else 0, edit=True)

        if parts[0] == "ML":
            log_id_prefix = parts[1] if len(parts) > 1 else ""
            lg = await col_logs.find_one({"_id": {"$regex": f"^{re.escape(log_id_prefix)}"}, "tg_user_id": event.sender_id})
            if not lg:
                lg = await col_logs.find_one({"_id": {"$regex": f"^{re.escape(log_id_prefix)}"}})
                if not lg or not await _is_admin():
                    return await event.answer("❌ Mail not found", alert=True)
            if not lg.get("read"):
                await col_logs.update_one({"_id": lg["_id"]}, {"$set": {"read": True}})
            body = lg.get("body", "")
            clean_body  = clean_html_body(body, 3500)
            star_icon   = "⭐ " if lg.get("starred") else ""
            text = (
                f"{star_icon}📨 **Mail Reader**\n━━━━━━━━━━━━━━━━━━━━\n\n"
                f"👤 **From:** `{short(lg.get('from', 'Unknown'), 50)}`\n"
                f"🎯 **To:** `{lg.get('original_to', lg.get('alias_email', ''))}`\n"
                f"📧 **Alias:** `{lg.get('alias_email', 'N/A')}`\n"
                f"📅 **Date:** {format_datetime(lg.get('received_at'))}\n\n"
                f"📝 **Subject:**\n**{lg.get('subject', 'No Subject')}**\n━━━━━━━━━━━━━━━━━━━━\n\n"
                f"{clean_body}\n━━━━━━━━━━━━━━━━━━━━"
            )
            buttons = [
                [Button.inline("🗑️ Delete", cb("MD", log_id_prefix)),
                 Button.inline("⭐ Star/Unstar", cb("MK", log_id_prefix))],
                [Button.inline("📩 Mark Unread", cb("MU", log_id_prefix)),
                 Button.inline("⬅️ Inbox", cb("M", "inbox", "0"))],
            ]
            return await event.edit(text, buttons=buttons, link_preview=False)

        if parts[0] == "MD":
            log_id_prefix = parts[1] if len(parts) > 1 else ""
            lg = await col_logs.find_one({"_id": {"$regex": f"^{re.escape(log_id_prefix)}"}, "tg_user_id": event.sender_id})
            if not lg:
                lg = await col_logs.find_one({"_id": {"$regex": f"^{re.escape(log_id_prefix)}"}})
                if not lg or not await _is_admin():
                    return await event.answer("❌ Mail not found", alert=True)
            await col_logs.update_one({"_id": lg["_id"]}, {"$set": {"deleted": True, "deleted_at": now_utc()}})
            await event.answer("🗑️ Mail deleted", alert=True)
            return await show_inbox(event, col_logs, page=0, edit=True)

        if parts[0] == "MK":
            log_id_prefix = parts[1] if len(parts) > 1 else ""
            lg = await col_logs.find_one({"_id": {"$regex": f"^{re.escape(log_id_prefix)}"}, "tg_user_id": event.sender_id})
            if not lg:
                lg = await col_logs.find_one({"_id": {"$regex": f"^{re.escape(log_id_prefix)}"}})
                if not lg or not await _is_admin():
                    return await event.answer("❌ Mail not found", alert=True)
            is_starred = lg.get("starred", False)
            await col_logs.update_one({"_id": lg["_id"]}, {"$set": {"starred": not is_starred}})
            return await event.answer("⭐ Starred" if not is_starred else "☆ Unstarred", alert=True)

        if parts[0] == "MU":
            log_id_prefix = parts[1] if len(parts) > 1 else ""
            lg = await col_logs.find_one({"_id": {"$regex": f"^{re.escape(log_id_prefix)}"}, "tg_user_id": event.sender_id})
            if not lg:
                return await event.answer("❌ Mail not found", alert=True)
            await col_logs.update_one({"_id": lg["_id"]}, {"$set": {"read": False}})
            return await event.answer("📩 Marked as unread", alert=True)

        if parts[0] == "SET":
            action = parts[1] if len(parts) > 1 else ""
            if action == "notif":
                u = await cached_find_user(event.sender_id, col_users, user_cache)
                current = u.get("notifications", True) if u else True
                await col_users.update_one({"tg_user_id": event.sender_id}, {"$set": {"notifications": not current}})
                await invalidate_user(event.sender_id, user_cache)
                new_status = "OFF" if current else "ON"
                await event.answer(f"🔔 Notifications: {new_status}", alert=True)
                return await show_user_settings(event, col_users, user_cache, edit=True)
            elif action == "clear_confirm":
                total_mails = await col_logs.count_documents({"tg_user_id": event.sender_id, "deleted": {"$ne": True}})
                return await event.edit(
                    f"⚠️ **Confirm Delete All**\n\nDelete all **{total_mails}** mails?\nThis cannot be undone!",
                    buttons=[
                        [Button.inline("🗑️ Yes, Delete All", cb("SET", "clear_yes"))],
                        [Button.inline("❌ Cancel", cb("M", "settings"))]
                    ]
                )
            elif action == "clear_yes":
                result = await col_logs.update_many(
                    {"tg_user_id": event.sender_id, "deleted": {"$ne": True}},
                    {"$set": {"deleted": True, "deleted_at": now_utc()}}
                )
                return await event.edit(f"✅ Deleted {result.modified_count} mails.", buttons=[[Button.inline("⬅️ Back", cb("M", "back"))]])
            elif action == "clear_read":
                result = await col_logs.update_many(
                    {"tg_user_id": event.sender_id, "read": True, "deleted": {"$ne": True}},
                    {"$set": {"deleted": True, "deleted_at": now_utc()}}
                )
                await event.answer(f"✅ Deleted {result.modified_count} read mails", alert=True)
                return await show_user_settings(event, col_users, user_cache, edit=True)
            return

    return on_callback


# =====================================================================
# MESSAGE HANDLER FACTORY
# =====================================================================
def make_message_handler(
    bot_instance, col_users, col_aliases, col_logs,
    alias_cache, alias_token_cache_dict,
    admin_state, super_admin_ids,
    refresh_cache_fn, refresh_tokens_fn,
    user_cache, count_cache,
):
    async def on_message(event):
        if not event.raw_text:
            return
        text = event.raw_text.strip()
        if text.startswith("/"):
            admin_state.pop(event.sender_id, None)
            return

        async def _is_admin():
            return await is_admin(event.sender_id, col_users, super_admin_ids, user_cache)

        st = admin_state.get(event.sender_id)
        if not st:
            if await _is_admin() and text == "🛠️ Admin Panel":
                return await admin_panel(event, bot_instance, col_users, col_aliases, col_logs, count_cache)
            has_access, _ = await check_user_access(event.sender_id, col_users, user_cache)
            if has_access:
                quick_actions = {
                    "📥 Inbox":      lambda: show_inbox(event, col_logs, page=0, edit=False),
                    "📧 My Emails":  lambda: show_user_emails(event, col_aliases, col_logs, edit=False),
                    "⭐ Starred":    lambda: show_starred(event, col_logs, page=0, edit=False),
                    "📊 Statistics": lambda: show_user_stats(event, col_users, col_aliases, col_logs, user_cache, edit=False),
                    "⚙️ Settings":   lambda: show_user_settings(event, col_users, user_cache, edit=False),
                    "ℹ️ Help":       lambda: show_user_help(event, edit=False),
                }
                if text in quick_actions:
                    return await quick_actions[text]()
            return

        if not await _is_admin():
            admin_state.pop(event.sender_id, None)
            return

        if st["stage"] == "add_user_wait_id":
            tg_id = None
            username = None
            if event.fwd_from and event.fwd_from.from_id:
                try:
                    tg_id = event.fwd_from.from_id.user_id
                except Exception:
                    pass
            if not tg_id and text.startswith("@"):
                username = text[1:]
                try:
                    entity = await bot_instance.get_entity(username)
                    tg_id = entity.id
                except Exception:
                    pass
            if not tg_id and text.isdigit():
                tg_id = int(text)
            if not tg_id:
                return await event.reply("❌ Invalid input.\n\nSend User ID, @username, or forward a message.", buttons=[[Button.inline("❌ Cancel", cb("X", "cancel"))]])
            try:
                entity = await bot_instance.get_entity(tg_id)
                name = getattr(entity, 'first_name', '') or ""
                username = getattr(entity, 'username', '') or ""
            except Exception:
                name = "Unknown"; username = ""
            await col_users.update_one(
                {"tg_user_id": tg_id},
                {"$set": {
                    "tg_user_id": tg_id, "username": username, "name": name,
                    "role": "user", "status": "active",
                    "created_at": now_utc(), "updated_at": now_utc(), "notifications": True
                }},
                upsert=True
            )
            await invalidate_user(tg_id, user_cache)
            count_cache.clear()
            admin_state.pop(event.sender_id, None)
            return await event.reply(
                f"✅ **User Added**\n━━━━━━━━━━━━━━━━━━━━\n\n"
                f"👤 Name: **{name}**\n🆔 ID: `{tg_id}`\n📊 Status: ✅ Active\n\n"
                "You can now assign email aliases to this user.",
                buttons=[
                    [Button.inline("➕ Add Email", cb("UM", "addemail", str(tg_id))),
                     Button.inline("👤 View User", cb("UM", "view", str(tg_id)))],
                    [Button.inline("⬅️ Back", cb("A", "users"))]
                ]
            )

        if st["stage"] == "search_user":
            search_term = text.strip()
            u = None
            if search_term.isdigit():
                u = await col_users.find_one({"tg_user_id": int(search_term)})
            elif search_term.startswith("@"):
                u = await col_users.find_one({"username": {"$regex": f"^{re.escape(search_term[1:])}$", "$options": "i"}})
            else:
                u = await col_users.find_one({"$or": [
                    {"username": {"$regex": re.escape(search_term), "$options": "i"}},
                    {"name": {"$regex": re.escape(search_term), "$options": "i"}}
                ]})
            if u:
                admin_state.pop(event.sender_id, None)
                return await event.reply(
                    f"✅ **User Found**\n\n👤 {u.get('name', 'Unknown')} — `{u.get('tg_user_id')}`",
                    buttons=[[Button.inline("📋 View Details", cb("UM", "view", str(u['tg_user_id'])))]]
                )
            return await event.reply("❌ User not found.\nTry another ID, username, or name.", buttons=[[Button.inline("❌ Cancel", cb("X", "cancel"))]])

        if st["stage"] == "add_email_pick_user":
            target_tg = None
            if text.isdigit():
                target_tg = int(text)
            elif text.startswith("@"):
                u = await col_users.find_one({"username": {"$regex": f"^{re.escape(text[1:])}$", "$options": "i"}})
                if u:
                    target_tg = u['tg_user_id']
            if not target_tg:
                return await event.reply("❌ Invalid input. Send numeric User ID or @username.", buttons=[[Button.inline("❌ Cancel", cb("X", "cancel"))]])
            u = await cached_find_user(target_tg, col_users, user_cache)
            if not u:
                return await event.reply("❌ User not in database. Add them first.", buttons=[[Button.inline("➕ Add User", cb("U", "add"))], [Button.inline("❌ Cancel", cb("X", "cancel"))]])
            st["payload"]["target_tg"] = target_tg
            st["payload"]["user_id"]   = f"U{target_tg}"
            st["stage"] = "add_email_wait_email"
            admin_state[event.sender_id] = st
            return await event.reply(
                f"✅ Target: **{u.get('name', 'Unknown')}** (`{target_tg}`)\n\nNow send the email address to assign:\nExample: `user@yourdomain.com`",
                buttons=[[Button.inline("❌ Cancel", cb("X", "cancel"))]]
            )

        if st["stage"] == "add_email_wait_email":
            if "@" not in text or "." not in text:
                return await event.reply("❌ Invalid email format.", buttons=[[Button.inline("❌ Cancel", cb("X", "cancel"))]])
            alias_email = text.lower().strip()
            target_tg   = int(st["payload"]["target_tg"])

            if email_exists_in_other_bot(alias_email, bot_instance):
                admin_state.pop(event.sender_id, None)
                return await event.reply(
                    f"❌ **Cross-Bot Conflict!**\n\n`{alias_email}` is already assigned in the **other bot**.\n"
                    "Each email address can only be used in one bot.",
                    buttons=[[Button.inline("⬅️ Back", cb("A", "aliases"))]]
                )

            other_bot_db_check = await email_exists_in_other_bot_db(alias_email, bot_instance)
            if other_bot_db_check:
                admin_state.pop(event.sender_id, None)
                return await event.reply(
                    f"❌ **Cross-Bot Conflict!**\n\n`{alias_email}` exists in the **other bot's database**.\n"
                    "Remove it from the other bot first.",
                    buttons=[[Button.inline("⬅️ Back", cb("A", "aliases"))]]
                )

            existing = await col_aliases.find_one({"alias_email": alias_email})
            if existing:
                if existing.get("active", False) and make_aware(existing.get("expires_at", now_utc())) > now_utc():
                    if existing.get("tg_user_id") == target_tg:
                        return await event.reply(
                            f"ℹ️ This email is already assigned to this user.\nExpires: {time_remaining(existing.get('expires_at'))}",
                            buttons=[[Button.inline("❌ Cancel", cb("X", "cancel"))]]
                        )
                    return await event.reply(
                        f"⚠️ Email is active and assigned to user `{existing['tg_user_id']}`.\nDeactivate it first or choose a different email.",
                        buttons=[[Button.inline("❌ Cancel", cb("X", "cancel"))]]
                    )
            st["payload"]["alias_email"] = alias_email
            st["stage"] = "add_email_wait_duration"
            admin_state[event.sender_id] = st
            return await event.reply(f"✅ Email: `{alias_email}`\n\nSelect validity period:", buttons=duration_kb())

        if st["stage"] == "add_email_wait_duration":
            return

        if st["stage"] == "add_email_wait_custom_days":
            if not text.isdigit():
                return await event.reply("❌ Send days as a number.", buttons=[[Button.inline("❌ Cancel", cb("X", "cancel"))]])
            days = int(text)
            if days <= 0 or days > 3650:
                return await event.reply("❌ Days must be 1-3650.", buttons=[[Button.inline("❌ Cancel", cb("X", "cancel"))]])
            return await finalize_add_email(
                event.sender_id, event, days,
                bot_instance, col_aliases, alias_cache, alias_token_cache_dict, admin_state, count_cache
            )

        if st["stage"] == "search_email":
            alias = await col_aliases.find_one({"alias_email": {"$regex": re.escape(text.lower().strip()), "$options": "i"}})
            if alias:
                admin_state.pop(event.sender_id, None)
                token = sha256(alias["alias_email"])[:12]
                return await event.reply("✅ Email found!", buttons=[[Button.inline("📋 View Details", cb("EA", token, "view"))]])
            return await event.reply("❌ Email not found.", buttons=[[Button.inline("❌ Cancel", cb("X", "cancel"))]])

        if st["stage"] == "broadcast_wait_text":
            msg_text    = event.message.message or text
            entities    = event.message.entities or []
            st["payload"]["text"]       = msg_text
            st["payload"]["entities"]   = entities
            st["payload"]["message_obj"] = event.message
            st["stage"] = "broadcast_confirm"
            admin_state[event.sender_id] = st
            target = st["payload"]["target_type"]
            t_str  = "All Users" if target == "all" else "Active Users"
            return await event.reply(
                f"📢 **Broadcast Preview** → {t_str}\n━━━━━━━━━━━━━━━━━━━━\n\n"
                f"{msg_text or '_Media Message_'}\n\nSend this message?",
                buttons=[
                    [Button.inline("✅ Send Now", cb("BC", "send"))],
                    [Button.inline("❌ Cancel", cb("X", "cancel"))]
                ]
            )

        if st["stage"] == "reassign_email_wait_user":
            target_tg = None
            if text.isdigit():
                target_tg = int(text)
            elif text.startswith("@"):
                u = await col_users.find_one({"username": {"$regex": f"^{re.escape(text[1:])}$", "$options": "i"}})
                if u:
                    target_tg = u['tg_user_id']
            if not target_tg:
                return await event.reply("❌ Invalid. Send User ID or @username.", buttons=[[Button.inline("❌ Cancel", cb("X", "cancel"))]])
            u = await cached_find_user(target_tg, col_users, user_cache)
            if not u:
                return await event.reply("❌ User not found.", buttons=[[Button.inline("❌ Cancel", cb("X", "cancel"))]])
            alias_email = st["payload"]["alias_email"]
            await col_aliases.update_one(
                {"alias_email": alias_email},
                {"$set": {"tg_user_id": target_tg, "user_id": f"U{target_tg}", "updated_at": now_utc()}}
            )
            await refresh_cache_fn(force=True)
            count_cache.clear()
            admin_state.pop(event.sender_id, None)
            uname = u.get("name", "Unknown")
            await event.reply(
                f"✅ **Email Reassigned**\n\n📧 `{alias_email}`\n👤 New user: **{uname}** (`{target_tg}`)",
                buttons=[[Button.inline("⬅️ Back", cb("A", "aliases"))]]
            )
            try:
                await bot_instance.send_message(target_tg, f"📧 **Email Assigned**\n\nEmail `{alias_email}` has been assigned to you.")
            except Exception:
                pass
            return

    return on_message


# =====================================================================
# /start, /admin, /help, /inbox, /stats HANDLERS
# =====================================================================
def make_start_handler(bot_instance, col_users, col_aliases, col_logs, super_admin_ids, user_cache, count_cache):
    async def on_start(event):
        sender   = event.sender
        username = (sender.username or "") if sender else ""
        name     = (sender.first_name or "") if sender else ""
        await get_or_create_user(event.sender_id, col_users, super_admin_ids, user_cache, username=username, name=name)
        has_access, status = await check_user_access(event.sender_id, col_users, user_cache)
        if await is_admin(event.sender_id, col_users, super_admin_ids, user_cache):
            return await admin_panel(event, bot_instance, col_users, col_aliases, col_logs, count_cache)
        if not has_access:
            if status == "pending":
                username_display = f"@{username}" if username else "Not set"
                return await event.respond(
                    "⏳ Access Pending\n━━━━━━━━━━━━━━━━━━━━\n\n"
                    f"👤 Name: {name}\n📛 Username: {username_display}\n🆔 ID: {event.sender_id}\n\n"
                    "Your access request has been sent to the admin.\nPlease wait for approval.",
                    buttons=[[Button.inline("🔄 Check Status", cb("CS", "check"))]]
                )
            elif status == "banned":
                return await event.respond("⛔ Access Denied\n\nYour account has been banned.\nContact administrator for help.")
            return await event.respond("❌ Not Registered\n\nPlease contact admin for access.")
        return await user_panel(event, col_users, col_aliases, col_logs, user_cache, count_cache)
    return on_start

def make_admin_cmd_handler(bot_instance, col_users, col_aliases, col_logs, super_admin_ids, user_cache, count_cache):
    async def on_admin_cmd(event):
        if not await is_admin(event.sender_id, col_users, super_admin_ids, user_cache):
            return await event.respond("❌ Admin access required.")
        return await admin_panel(event, bot_instance, col_users, col_aliases, col_logs, count_cache)
    return on_admin_cmd

def make_inbox_cmd_handler(col_users, col_logs, user_cache):
    async def on_inbox_cmd(event):
        has_access, _ = await check_user_access(event.sender_id, col_users, user_cache)
        if not has_access:
            return await event.respond("❌ Access denied. Use /start first.")
        return await show_inbox(event, col_logs, page=0)
    return on_inbox_cmd

def make_stats_cmd_handler(col_users, col_aliases, col_logs, user_cache):
    async def on_stats_cmd(event):
        has_access, _ = await check_user_access(event.sender_id, col_users, user_cache)
        if not has_access:
            return await event.respond("❌ Access denied.")
        return await show_user_stats(event, col_users, col_aliases, col_logs, user_cache)
    return on_stats_cmd


# =====================================================================
# REGISTER HANDLERS
# =====================================================================
def register_bot_handlers(
    bot_instance, col_users, col_aliases, col_logs,
    alias_cache, alias_token_cache_dict,
    admin_state, super_admin_ids,
    refresh_cache_fn, refresh_tokens_fn,
    user_cache, count_cache,
):
    callback_handler = make_callback_handler(
        bot_instance, col_users, col_aliases, col_logs,
        alias_cache, alias_token_cache_dict,
        admin_state, super_admin_ids,
        refresh_cache_fn, refresh_tokens_fn,
        user_cache, count_cache,
    )
    message_handler = make_message_handler(
        bot_instance, col_users, col_aliases, col_logs,
        alias_cache, alias_token_cache_dict,
        admin_state, super_admin_ids,
        refresh_cache_fn, refresh_tokens_fn,
        user_cache, count_cache,
    )
    bot_instance.add_event_handler(
        make_start_handler(bot_instance, col_users, col_aliases, col_logs, super_admin_ids, user_cache, count_cache),
        events.NewMessage(pattern=r"^/start$")
    )
    bot_instance.add_event_handler(
        make_admin_cmd_handler(bot_instance, col_users, col_aliases, col_logs, super_admin_ids, user_cache, count_cache),
        events.NewMessage(pattern=r"^/admin$")
    )
    bot_instance.add_event_handler(lambda e: show_user_help(e), events.NewMessage(pattern=r"^/help$"))
    bot_instance.add_event_handler(make_inbox_cmd_handler(col_users, col_logs, user_cache), events.NewMessage(pattern=r"^/inbox$"))
    bot_instance.add_event_handler(make_stats_cmd_handler(col_users, col_aliases, col_logs, user_cache), events.NewMessage(pattern=r"^/stats$"))
    bot_instance.add_event_handler(callback_handler, events.CallbackQuery())
    bot_instance.add_event_handler(message_handler, events.NewMessage())


# =====================================================================
# PERIODIC CACHE REFRESH
# =====================================================================
async def cache_refresh_loop():
    while True:
        try:
            await asyncio.gather(
                refresh_bot1_alias_cache(force=True),
                refresh_bot2_alias_cache(force=True),
            )
        except Exception as e:
            logger.warning(f"[Cache] Refresh error: {e}")
        await asyncio.sleep(30)


# =====================================================================
# MAIN
# =====================================================================
async def main():
    logger.info("=" * 60)
    logger.info("  MasterMailBot — Dual Bot + SMTP + uvloop + TTL Cache")
    logger.info(f"  uvloop: {'✅ Active' if _UVLOOP else '❌ Not installed'}")
    logger.info("=" * 60)

    await bot1.start(bot_token=BOT1_TG_TOKEN)
    await bot2.start(bot_token=BOT2_TG_TOKEN)
    logger.info("✅ Bot1 (Nihal) and Bot2 (Maruf) connected")

    await asyncio.gather(
        ensure_indexes(bot1_col_users, bot1_col_aliases, bot1_col_logs),
        ensure_indexes(bot2_col_users, bot2_col_aliases, bot2_col_logs),
    )
    logger.info("✅ DB indexes ensured")

    await asyncio.gather(
        refresh_bot1_alias_cache(force=True),
        refresh_bot1_alias_tokens(force=True),
        refresh_bot2_alias_cache(force=True),
        refresh_bot2_alias_tokens(force=True),
    )
    logger.info("✅ Alias caches loaded")

    register_bot_handlers(
        bot1, bot1_col_users, bot1_col_aliases, bot1_col_logs,
        bot1_alias_cache, bot1_alias_token_cache,
        bot1_admin_state, BOT1_SUPER_ADMIN_IDS,
        refresh_bot1_alias_cache, refresh_bot1_alias_tokens,
        bot1_user_cache, bot1_count_cache,
    )
    register_bot_handlers(
        bot2, bot2_col_users, bot2_col_aliases, bot2_col_logs,
        bot2_alias_cache, bot2_alias_token_cache,
        bot2_admin_state, BOT2_SUPER_ADMIN_IDS,
        refresh_bot2_alias_cache, refresh_bot2_alias_tokens,
        bot2_user_cache, bot2_count_cache,
    )
    logger.info("✅ Event handlers registered")

    smtp_controller = None
    if AIOSMTPD_AVAILABLE:
        smtp_controller = Controller(MasterSMTPHandler(), hostname=SMTP_HOST, port=SMTP_PORT)
        smtp_controller.start()
        logger.info(f"✅ SMTP server on {SMTP_HOST}:{SMTP_PORT}")
    else:
        logger.warning("⚠️  aiosmtpd not installed — SMTP disabled. Run: pip install aiosmtpd")

    refresh_task = asyncio.create_task(cache_refresh_loop())
    logger.info("✅ Background cache refresh (30s)")
    logger.info("🚀 All systems online!")

    try:
        await asyncio.gather(
            bot1.run_until_disconnected(),
            bot2.run_until_disconnected(),
        )
    finally:
        refresh_task.cancel()
        try:
            await refresh_task
        except Exception:
            pass
        if smtp_controller:
            smtp_controller.stop()
        await bot1.disconnect()
        await bot2.disconnect()
        mongo1.close()
        mongo2.close()
        logger.info("👋 MasterMailBot shut down.")


if __name__ == "__main__":
    asyncio.run(main())
