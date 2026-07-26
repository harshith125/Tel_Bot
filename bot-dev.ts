import { config } from "dotenv";
import { resolve } from "path";

// Load Next.js environment variables
config({ path: resolve(process.cwd(), ".env.local") });
config({ path: resolve(process.cwd(), ".env") });

async function start() {
  const { bot } = await import("./lib/bot");
  console.log("Starting Telegram Bot in long-polling mode (development)...");
  bot.start();
}

start();
