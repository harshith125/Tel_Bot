import { config } from "dotenv";
import { resolve } from "path";

// Load Next.js environment variables
config({ path: resolve(process.cwd(), ".env.local") });
config({ path: resolve(process.cwd(), ".env") });

async function start() {
  const { bot } = await import("./lib/bot");
  console.log("=======================================================");
  console.log("🚀 Starting Telegram Bot in Long-Polling Mode (Local Dev)");
  console.log("⚠️  NOTICE: Long-polling temporarily overrides any registered");
  console.log("   Vercel webhook. Stop this process (Ctrl+C) when done.");
  console.log("👉 To switch back to Vercel, run: npm run set-webhook");
  console.log("=======================================================\n");

  bot.start({
    drop_pending_updates: true,
  });
}

start();
