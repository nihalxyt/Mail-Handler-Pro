import { MongoClient } from "mongodb";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";

const SALT_ROUNDS = 12;

function generatePassword(length = 12): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%";
  const bytes = crypto.randomBytes(length);
  return Array.from(bytes)
    .map((b) => alphabet[b % alphabet.length])
    .join("");
}

interface AliasDoc {
  alias_email: string;
  tg_user_id: number;
  password?: string;
}

async function migrateDb(uri: string, dbName: string, label: string) {
  if (!uri) {
    console.log(`⏭  Skipping ${label} — no URI configured`);
    return;
  }

  console.log(`\n🔗 Connecting to ${label}...`);
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);
  const col = db.collection<AliasDoc>("aliases");

  const withoutPassword = await col
    .find({ $or: [{ password: { $exists: false } }, { password: null }, { password: "" }] })
    .toArray();

  console.log(`📊 ${label}: Found ${withoutPassword.length} aliases without passwords`);

  if (withoutPassword.length === 0) {
    console.log(`✅ ${label}: All aliases already have passwords`);
    await client.close();
    return;
  }

  const results: { email: string; password: string; tgUserId: number }[] = [];

  for (const alias of withoutPassword) {
    const plainPassword = generatePassword(12);
    const hashed = await bcrypt.hash(plainPassword, SALT_ROUNDS);

    await col.updateOne(
      { alias_email: alias.alias_email },
      {
        $set: {
          password: hashed,
          updated_at: new Date(),
        },
      }
    );

    results.push({
      email: alias.alias_email,
      password: plainPassword,
      tgUserId: alias.tg_user_id,
    });

    console.log(`  ✅ ${alias.alias_email} — password set`);
  }

  console.log(`\n📋 ${label} Migration Summary:`);
  console.log("─".repeat(60));
  for (const r of results) {
    console.log(`  Email: ${r.email}`);
    console.log(`  TG User: ${r.tgUserId}`);
    console.log(`  Password: ${r.password}`);
    console.log("─".repeat(60));
  }

  await client.close();
  console.log(`✅ ${label}: Migration complete — ${results.length} passwords generated`);
}

async function main() {
  console.log("🔐 Password Migration Script");
  console.log("=".repeat(60));
  console.log("This script generates bcrypt-hashed passwords for all aliases");
  console.log("that currently lack a web login password.\n");

  const bot1Uri = process.env["BOT1_MONGO_URI"] || "";
  const bot1DbName = process.env["BOT1_DB_NAME"] || "mailbot_pro";
  const bot2Uri = process.env["BOT2_MONGO_URI"] || "";
  const bot2DbName = process.env["BOT2_DB_NAME"] || "mailbot_pro";

  await migrateDb(bot1Uri, bot1DbName, "Bot1");
  await migrateDb(bot2Uri, bot2DbName, "Bot2");

  console.log("\n🎉 Migration complete!");
  console.log("⚠️  IMPORTANT: Save the passwords above and distribute to users.");
  console.log("   Users can also reset their password via the Telegram bot.");
}

main().catch((err) => {
  console.error("❌ Migration failed:", err);
  process.exit(1);
});
