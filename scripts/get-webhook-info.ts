import { config } from "dotenv";
import { resolve } from "path";

// Load local environment variables
config({ path: resolve(process.cwd(), ".env.local") });
config({ path: resolve(process.cwd(), ".env") });

async function getWebhookInfo() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error("❌ Error: TELEGRAM_BOT_TOKEN is not defined in environment or .env file.");
    process.exit(1);
  }

  console.log("🔍 Querying Telegram Webhook Status (getWebhookInfo)...");

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
    const data = await res.json();

    if (!data.ok) {
      console.error("\n❌ Failed to query Telegram API:");
      console.error(`   ${data.description || JSON.stringify(data)}`);
      process.exit(1);
    }

    const info = data.result;
    console.log("\n================ Telegram Webhook Info ================");
    console.log(`🌐 Webhook URL:         ${info.url || "(None - Polling Mode)"}`);
    console.log(`📜 Custom Certificate:  ${info.has_custom_certificate ? "Yes" : "No"}`);
    console.log(`📬 Pending Updates:     ${info.pending_update_count ?? 0}`);
    console.log(`⚙️  Max Connections:     ${info.max_connections ?? 40}`);
    console.log(`🛡️  Allowed Updates:     ${info.allowed_updates ? info.allowed_updates.join(", ") : "All"}`);

    if (info.last_error_date) {
      const errorDate = new Date(info.last_error_date * 1000).toISOString();
      console.log(`⚠️  Last Error Date:     ${errorDate}`);
      console.log(`⚠️  Last Error Message:  ${info.last_error_message}`);
    } else {
      console.log(`✅ Last Error:          None reported`);
    }

    if (info.last_synchronization_error_date) {
      const syncDate = new Date(info.last_synchronization_error_date * 1000).toISOString();
      console.log(`⚠️  Last Sync Error:     ${syncDate}`);
    }

    console.log("=======================================================\n");

    if (info.url) {
      console.log("🟢 Status: Bot is configured for WEBHOOK mode.");
    } else {
      console.log("🟡 Status: Webhook is NOT set. The bot is ready for polling or awaiting setWebhook.");
    }
  } catch (error) {
    console.error("\n❌ Network error while querying getWebhookInfo:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

getWebhookInfo();
