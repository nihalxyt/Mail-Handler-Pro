import { MongoClient, type Db } from "mongodb";
import { logger } from "./logger";

const MONGO_OPTS = {
  maxPoolSize: 20,
  minPoolSize: 2,
  maxIdleTimeMS: 45000,
  connectTimeoutMS: 5000,
  serverSelectionTimeoutMS: 5000,
  retryWrites: true,
  w: "majority" as const,
};

const BOT1_MONGO_URI = process.env["BOT1_MONGO_URI"] || "";
const BOT1_DB_NAME = process.env["BOT1_DB_NAME"] || "mailbot_pro";
const BOT2_MONGO_URI = process.env["BOT2_MONGO_URI"] || "";
const BOT2_DB_NAME = process.env["BOT2_DB_NAME"] || "mailbot_pro";

let client1: MongoClient | null = null;
let client2: MongoClient | null = null;

const dbMap: Record<string, Db> = {};

export async function connectMongo(): Promise<void> {
  if (!BOT1_MONGO_URI && !BOT2_MONGO_URI) {
    logger.warn("MongoDB URIs not configured — skipping connection");
    return;
  }

  if (BOT1_MONGO_URI) {
    try {
      client1 = new MongoClient(BOT1_MONGO_URI, MONGO_OPTS);
      await client1.connect();
      dbMap["bot1"] = client1.db(BOT1_DB_NAME);
      logger.info("Connected to Bot1 MongoDB");
    } catch (err) {
      logger.error({ err }, "Failed to connect to Bot1 MongoDB");
      throw err;
    }
  }

  if (BOT2_MONGO_URI) {
    try {
      client2 = new MongoClient(BOT2_MONGO_URI, MONGO_OPTS);
      await client2.connect();
      dbMap["bot2"] = client2.db(BOT2_DB_NAME);
      logger.info("Connected to Bot2 MongoDB");
    } catch (err) {
      logger.error({ err }, "Failed to connect to Bot2 MongoDB");
      throw err;
    }
  }
}

export function getDb(key: "bot1" | "bot2"): Db | null {
  return dbMap[key] || null;
}

export function getAllDbKeys(): ("bot1" | "bot2")[] {
  return Object.keys(dbMap) as ("bot1" | "bot2")[];
}

export interface AliasDoc {
  alias_email: string;
  tg_user_id: number;
  user_id: string;
  active: boolean;
  created_at: Date;
  updated_at: Date;
  expires_at: Date;
  created_by: number;
  password?: string;
}

export interface MailLogDoc {
  _id: string;
  dedupe_key: string;
  alias_email: string;
  original_to: string;
  tg_user_id: number;
  from: string;
  subject: string;
  date_header: string;
  received_at: Date;
  snippet: string;
  body: string;
  read: boolean;
  deleted: boolean;
  starred: boolean;
  bot: string;
  admin_fallback?: boolean;
  fallback_reason?: string;
}

export interface UserDoc {
  _id: string;
  tg_user_id: number;
  username: string;
  name: string;
  role: string;
  status: string;
  notifications: boolean;
  created_at: Date;
  updated_at: Date;
  stats: { total_mails: number; total_aliases: number };
}

export async function findAliasByEmail(
  email: string
): Promise<{ alias: AliasDoc; dbKey: "bot1" | "bot2" } | null> {
  const lower = email.toLowerCase();
  for (const key of getAllDbKeys()) {
    const db = dbMap[key];
    if (!db) continue;
    const alias = await db
      .collection<AliasDoc>("aliases")
      .findOne({ alias_email: lower });
    if (alias) return { alias, dbKey: key };
  }
  return null;
}

export async function findAllAliasesByTgUser(
  tgUserId: number
): Promise<{ alias: AliasDoc; dbKey: "bot1" | "bot2"; dbLabel: string }[]> {
  const results: { alias: AliasDoc; dbKey: "bot1" | "bot2"; dbLabel: string }[] = [];
  for (const key of getAllDbKeys()) {
    const db = dbMap[key];
    if (!db) continue;
    const aliases = await db
      .collection<AliasDoc>("aliases")
      .find({ tg_user_id: tgUserId })
      .toArray();
    for (const a of aliases) {
      results.push({
        alias: a,
        dbKey: key,
        dbLabel: key === "bot1" ? "Bot1" : "Bot2",
      });
    }
  }
  return results;
}
