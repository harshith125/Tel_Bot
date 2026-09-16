import { GET, POST } from "../app/api/webhook/route";

async function runTests() {
  console.log("--- Starting Route Handler Verification Tests ---");

  // 1. Test GET /api/webhook
  const getRes = await GET();
  const getData = await getRes.json();
  console.log("1. GET /api/webhook status:", getRes.status, getData);
  if (getRes.status !== 200 || !getData.ok) {
    throw new Error("GET test failed");
  }

  // 2. Test POST /api/webhook with invalid secret (when secret is configured)
  process.env.TELEGRAM_WEBHOOK_SECRET = "test_secret_12345";
  const fakeReqBadSecret = new Request("https://example.com/api/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-telegram-bot-api-secret-token": "wrong_secret",
    },
    body: JSON.stringify({ update_id: 1001 }),
  });

  const postUnauthorized = await POST(fakeReqBadSecret);
  console.log("2. POST /api/webhook with invalid secret status:", postUnauthorized.status);
  if (postUnauthorized.status !== 401) {
    throw new Error(`Expected 401 Unauthorized but got ${postUnauthorized.status}`);
  }

  // 3. Test POST /api/webhook with missing secret header (when secret is configured)
  const fakeReqNoSecret = new Request("https://example.com/api/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ update_id: 1002 }),
  });

  const postMissingHeader = await POST(fakeReqNoSecret);
  console.log("3. POST /api/webhook with missing header status:", postMissingHeader.status);
  if (postMissingHeader.status !== 401) {
    throw new Error(`Expected 401 Unauthorized but got ${postMissingHeader.status}`);
  }

  console.log("✅ All Route Handler tests passed successfully!");
}

runTests().catch((err) => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
