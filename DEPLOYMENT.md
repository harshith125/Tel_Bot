# Deployment Guide: Telegram AI Resume Analyzer on Vercel

This guide provides step-by-step instructions to deploy the AI Resume Analyzer Telegram Bot to Vercel using Next.js App Router and Telegram Webhooks.

---

## Architecture Overview

```
Telegram User
      │
      ▼
Telegram Cloud (HTTPS POST)
      │
      ▼
Vercel Edge Network
      │
      ▼
Next.js Route Handler (/api/webhook)
      │
      ├─► X-Telegram-Bot-Api-Secret-Token Validation
      ├─► Grammy Webhook Adapter
      ├─► In-Memory Buffer Document Parsing (PDF / DOCX / ZIP)
      └─► Google Gemini API (Candidate Analysis & Q&A)
```

---

## 1. Prerequisites

Before starting, ensure you have:
1. **Telegram Bot Token**: Created via [@BotFather](https://t.me/Botfather) on Telegram.
2. **Google Gemini API Key**: Created via [Google AI Studio](https://aistudio.google.com/).
3. **GitHub Account**: To host your repository.
4. **Vercel Account**: Linked to your GitHub.
5. **Node.js**: v18 or later installed locally.

---

## 2. Local Setup & Testing

### Step A: Install Dependencies
```bash
npm install
```

### Step B: Configure Local Environment
Create `.env.local` (or `.env`) from `.env.example`:
```env
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-2.0-flash
TELEGRAM_WEBHOOK_SECRET=your_custom_secret_token_here
```

### Step C: Test Local Polling
Run the local polling development bot:
```bash
npm run bot
```
Open Telegram, send `/start` to your bot, and test uploading sample files and running `/analyze`.
*(Press `Ctrl + C` in the terminal to stop the local polling bot when done).*

---

## 3. Deploying to Vercel

### Step D: Push Code to GitHub
1. Initialize Git and commit your files:
   ```bash
   git init
   git add .
   git commit -m "Production ready Telegram bot on Vercel"
   ```
2. Push your repository to your GitHub account:
   ```bash
   git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
   git branch -M main
   git push -u origin main
   ```

### Step E: Import Project in Vercel
1. Log in to your [Vercel Dashboard](https://vercel.com/dashboard).
2. Click **Add New...** → **Project**.
3. Import your GitHub repository.
4. Under **Framework Preset**, Next.js will be detected automatically.

### Step F: Configure Environment Variables in Vercel
In the Vercel project configuration page (or under **Settings → Environment Variables**), add the following variables:

| Variable Name | Required | Target Environments | Description |
|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | **Yes** | Production, Preview, Development | Telegram Bot Token from @BotFather |
| `GEMINI_API_KEY` | **Yes** | Production, Preview, Development | API Key from Google AI Studio |
| `TELEGRAM_WEBHOOK_SECRET` | **Recommended** | Production, Preview | Custom secret string (1-256 alphanumeric characters) to secure the webhook |
| `GEMINI_MODEL` | Optional | Production, Preview, Development | Custom Gemini model name (defaults to `gemini-2.0-flash` with fallbacks) |
| `NEXT_PUBLIC_APP_URL` | Optional | Production | Your Vercel production URL (e.g. `https://your-app.vercel.app`) |

> [!CAUTION]
> Never prepend `NEXT_PUBLIC_` to `TELEGRAM_BOT_TOKEN`, `GEMINI_API_KEY`, or `TELEGRAM_WEBHOOK_SECRET`. Server-side secrets must remain private.

### Step G: Deploy
Click **Deploy**. Wait for the build and deployment to complete successfully.

---

## 4. Connecting Telegram Webhook to Vercel

Once your project is deployed, copy your production domain (e.g., `https://your-bot.vercel.app`).

### Step H: Register the Webhook
Run the automated registration script from your local terminal:

```bash
npm run set-webhook https://YOUR-VERCEL-DOMAIN.vercel.app
```

*Example Output:*
```
🔗 Registering Telegram Webhook...
📡 Target Webhook URL: https://your-bot.vercel.app/api/webhook
🔒 Secret Token Configured: Yes (Protected)

✅ Telegram Webhook registered successfully!
👉 Telegram will now send updates via POST to: https://your-bot.vercel.app/api/webhook
```

### Step I: Verify the Webhook Status
Run the diagnostic script:
```bash
npm run get-webhook-info
```

*Expected Verification Output:*
```
================ Telegram Webhook Info ================
🌐 Webhook URL:         https://your-bot.vercel.app/api/webhook
📜 Custom Certificate:  No
📬 Pending Updates:     0
⚙️  Max Connections:     40
🛡️  Allowed Updates:     message, callback_query, edited_message
✅ Last Error:          None reported
=======================================================
🟢 Status: Bot is configured for WEBHOOK mode.
```

---

## 5. End-to-End Verification

Perform these tests on Telegram to confirm everything is operational:

1. **Health Check**: Open in your browser: `https://YOUR-VERCEL-DOMAIN.vercel.app/api/webhook`.
   - Expected response: `{"ok":true,"service":"telegram-bot","status":"running"}`
2. **Start Command**: In Telegram, send `/start`.
   - The bot replies with the introductory welcome message and instructions.
3. **Upload Job Description**:
   - Send `/addjd` or paste a JD text (>50 characters) or upload a PDF/DOCX JD.
   - Confirm receipt message.
4. **Upload Resumes**:
   - Send `/addresume` or upload PDF/DOCX resumes (or a ZIP folder containing resumes).
   - Confirm receipt message.
5. **Run Analysis**:
   - Send `/analyze`.
   - Confirm candidate scores, evaluator reasoning, missing skills, and improvement suggestions appear.
6. **Ask Questions (Q&A)**:
   - Type a follow-up question (e.g., "Which candidate has the strongest experience with Python?").
   - Confirm the bot answers using the candidates' data.

---

## 6. Troubleshooting

### 1. `getWebhookInfo` shows `last_error_message: "Wrong response code: 401 Unauthorized"`
- **Cause**: The `TELEGRAM_WEBHOOK_SECRET` set in Telegram doesn't match the one configured in Vercel environment variables.
- **Fix**: Re-run `npm run set-webhook https://YOUR-DOMAIN.vercel.app` after ensuring your local `.env.local` and Vercel Environment Variables have the exact same secret.

### 2. `getWebhookInfo` shows `last_error_message: "Connection timed out"` or `504 Gateway Timeout`
- **Cause**: Processing too many large resumes at once exceeded the serverless execution duration.
- **Fix**: The webhook route is configured with `export const maxDuration = 60`. If processing large batches (>10 resumes simultaneously), analyze them in smaller batches.

### 3. File upload fails: `Failed to download file`
- **Cause**: Telegram Bot API limits regular bot file downloads to 20 MB.
- **Fix**: Ensure uploaded PDFs, DOCXs, or ZIP files are under 15–20 MB.

### 4. Gemini Rate Limits (`429 Too Many Requests`)
- **Cause**: Google Gemini free tier requests per minute (RPM) reached.
- **Fix**: The bot includes automatic retry and model fallback (`gemini-3.1-flash-lite`, `gemini-3.5-flash`, `gemini-2.5-flash-lite-latest`, `gemini-2.0-flash`). Upgrade your Google AI Studio plan if you anticipate high volume.

---

## 7. Switching Back to Local Polling (Optional)

If you need to switch back to local long polling development:
1. Delete the webhook:
   ```bash
   curl -F "url=" "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook"
   ```
2. Start polling:
   ```bash
   npm run bot
   ```
3. When ready for production again, run `npm run set-webhook https://YOUR-VERCEL-DOMAIN.vercel.app`.
