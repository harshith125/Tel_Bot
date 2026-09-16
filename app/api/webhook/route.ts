import { webhookCallback } from "grammy";
import { bot } from "@/lib/bot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const grammyHandler = webhookCallback(bot, "std/http", {
  timeoutMilliseconds: 55_000,
});

export async function POST(req: Request) {
  const secretToken = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secretToken) {
    const headerSecret = req.headers.get("x-telegram-bot-api-secret-token");
    if (!headerSecret || headerSecret !== secretToken) {
      return new Response(
        JSON.stringify({ error: "Unauthorized: Invalid secret token" }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  }

  return grammyHandler(req);
}

export async function GET() {
  return Response.json({
    ok: true,
    service: "telegram-bot",
    status: "running",
  });
}

