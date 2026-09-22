import { NextRequest, NextResponse } from "next/server";
import { bot } from "@/lib/bot";
import { syncAllConnectedFolders } from "@/lib/sync-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  try {
    const cronSecret = process.env.CRON_SECRET;
    
    // Validate secret if configured
    if (cronSecret) {
      const authHeader = req.headers.get("authorization");
      const urlSecret = req.nextUrl.searchParams.get("secret");

      const isBearerValid = authHeader === `Bearer ${cronSecret}`;
      const isParamValid = urlSecret === cronSecret;

      if (!isBearerValid && !isParamValid) {
        return NextResponse.json(
          { error: "Unauthorized: Invalid cron secret" },
          { status: 401 }
        );
      }
    }

    const results = await syncAllConnectedFolders(bot);

    return NextResponse.json({
      ok: true,
      timestamp: new Date().toISOString(),
      syncedFoldersCount: results.length,
      results,
    });
  } catch (error) {
    console.error("Error executing /api/cron/sync-drive:", error);
    const message = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 }
    );
  }
}
