import { config } from "dotenv";
import { resolve } from "path";

// Load local environment variables
config({ path: resolve(process.cwd(), ".env.local") });
config({ path: resolve(process.cwd(), ".env") });

async function setWebhook() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error("❌ Error: TELEGRAM_BOT_TOKEN is not defined in environment or .env file.");
    process.exit(1);
  }

  // Determine base URL from command line arg or environment variable
  const argUrl = process.argv[2];
  let rawUrl =
    argUrl ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined);

  if (!rawUrl) {
    console.error("❌ Error: Production URL is required.");
    console.error("\nUsage:");
    console.error("  npm run set-webhook https://your-project.vercel.app");
    console.error("  OR set NEXT_PUBLIC_APP_URL in your .env / .env.local file.");
    process.exit(1);
  }

  // Ensure https:// protocol
  if (!rawUrl.startsWith("http://") && !rawUrl.startsWith("https://")) {
    rawUrl = `https://${rawUrl}`;
  }

  // Ensure ends with /api/webhook
  const urlObj = new URL(rawUrl);
  if (!urlObj.pathname.endsWith("/api/webhook")) {
    urlObj.pathname = "/api/webhook";
  }
  const webhookUrl = urlObj.toString();

  const secretToken = process.env.TELEGRAM_WEBHOOK_SECRET;

  console.log("🔗 Registering Telegram Webhook...");
  console.log(`📡 Target Webhook URL: ${webhookUrl}`);
  console.log(`🔒 Secret Token Configured: ${secretToken ? "Yes (Protected)" : "No (Optional)"}`);

  const payload: Record<string, unknown> = {
    url: webhookUrl,
    allowed_updates: ["message", "callback_query", "edited_message"],
    drop_pending_updates: false,
  };

  if (secretToken) {
    payload.secret_token = secretToken;
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.json();

    if (data.ok) {
      console.log("\n✅ Telegram Webhook registered successfully!");
      console.log(`👉 Telegram will now send updates via POST to: ${webhookUrl}`);
    } else {
      console.error("\n❌ Telegram API rejected webhook registration:");
      console.error(`   ${data.description || JSON.stringify(data)}`);
      process.exit(1);
    }
  } catch (error) {
    console.error("\n❌ Network error while setting webhook:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

setWebhook();
