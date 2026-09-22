# Deployment Guide: HireMatrix AI on Vercel with Google Drive Integration

This guide provides step-by-step instructions to deploy the HireMatrix AI Telegram Bot with Google Drive file/folder integration and automatic background synchronization to Vercel.

---

## Architecture Overview

```
Telegram User                    Google Drive (Shared Folders/Files)
      │                                       │
      ├───────────────────────┬───────────────┘
      ▼                       ▼
Telegram Webhook        Vercel Cron (/api/cron/sync-drive)
      │                       │
      ├─► Validate Secret     ├─► Validate CRON_SECRET
      ├─► Grammy Adapter      ├─► Background File Discovery
      │                       └─► Multi-User Sync Engine
      ▼                               │
Document Processing Pipeline ◄────────┘
      │
      ├─► In-Memory Buffer Document Parsing (PDF / DOCX / ZIP / Drive)
      ├─► Candidate ID Extraction (CV273, CV390) & Classification
      ├─► Deduplication Engine (DriveFileId + ModifiedTime)
      ├─► Multi-Tier Google Gemini AI Analysis & Failover
      ├─► Multi-User State Persistence (`lib/db.ts`)
      └─► Real-Time Proactive Notifications & Interactive Q&A
```

---

## 1. Prerequisites

Before starting, ensure you have:
1. **Telegram Bot Token**: Created via [@BotFather](https://t.me/Botfather) on Telegram.
2. **Google Gemini API Key**: Created via [Google AI Studio](https://aistudio.google.com/).
3. **Google Cloud Service Account** (for Google Drive access):
   - Go to [Google Cloud Console](https://console.cloud.google.com/).
   - Create a project (or select existing).
   - Enable the **Google Drive API** under **APIs & Services → Enable APIs and Services**.
   - Create a **Service Account** under **IAM & Admin → Service Accounts**.
   - Generate and download a **JSON Key** for the Service Account.
   - Note the Service Account email address (e.g. `hirematrix-bot@your-project.iam.gserviceaccount.com`).
4. **GitHub Account**: To host your repository.
5. **Vercel Account**: Linked to your GitHub.

---

## 2. Setting Up Google Drive Folders

To allow HireMatrix AI to read and monitor private Google Drive folders:
1. Open Google Drive.
2. Right-click on your folder containing JDs or Resumes and click **Share**.
3. Add your **Service Account email** with **Viewer** permission.
4. Copy the link to the folder (e.g., `https://drive.google.com/drive/folders/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs`).
5. Send the link to the Telegram bot.

---

## 3. Environment Variables Configuration

Configure the following environment variables in `.env` (for local dev) and in **Vercel Settings → Environment Variables**:

| Variable Name | Required | Description |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | **Yes** | Telegram Bot Token from @BotFather |
| `GEMINI_API_KEY` | **Yes** | API Key from Google AI Studio |
| `GEMINI_MODEL` | Optional | Primary Gemini model (defaults to `gemini-3.1-flash-lite` with automatic multi-tier failover) |
| `TELEGRAM_WEBHOOK_SECRET` | **Recommended** | Secret string to secure Telegram webhook POST requests |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | **Recommended** | Full JSON key string (or base64 encoded) of the Google Service Account |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Optional | Alternative: Service Account email address |
| `GOOGLE_PRIVATE_KEY` | Optional | Alternative: Service Account private key |
| `GOOGLE_DRIVE_API_KEY` | Optional | Fallback API Key for public Google Drive links |
| `CRON_SECRET` | **Recommended** | Secret key securing the scheduled `/api/cron/sync-drive` endpoint |
| `NEXT_PUBLIC_APP_URL` | Optional | Your Vercel production domain (e.g., `https://your-bot.vercel.app`) |

---

## 4. Deploying to Vercel

### Step A: Push Code to GitHub
```bash
git add .
git commit -m "HireMatrix AI: Google Drive integration and automated sync"
git push origin main
```

### Step B: Configure Vercel Project & Cron
1. Import the repository in [Vercel Dashboard](https://vercel.com/dashboard).
2. Set all environment variables listed above.
3. The included `vercel.json` will automatically configure the background cron:
   ```json
   {
     "crons": [
       {
         "path": "/api/cron/sync-drive",
         "schedule": "*/5 * * * *"
       }
     ]
   }
   ```
4. Deploy the project.

---

## 5. Registering the Telegram Webhook

Once deployed, register the Telegram webhook to your Vercel domain:

```bash
npm run set-webhook https://YOUR-VERCEL-DOMAIN.vercel.app
```

Verify webhook status:
```bash
npm run get-webhook-info
```

---

## 6. Testing the Complete Workflow

### Test 1: Direct Telegram Upload (PDF/DOCX/ZIP)
- Send `/addjd` and upload `Job_Description.pdf`.
- Send `/addresume` and upload `CV273.pdf`.
- Send `/analyze`. Verify candidate ranking and scoring.

### Test 2: Single Google Drive File Link
- Send a Google Drive file link: `https://drive.google.com/file/d/FILE_ID/view`.
- Bot downloads, parses, and adds the file to your recruitment dataset.

### Test 3: Google Drive Folder Connection
- Send a Google Drive folder link: `https://drive.google.com/drive/folders/FOLDER_ID`.
- Bot connects the folder, reports total JDs and Resumes found, and runs analysis.

### Test 4: Automatic Detection of New Files (CRITICAL)
1. Add a new file `JD11.pdf` or `CV391.pdf` to the connected Google Drive folder.
2. Do **not** send any message to the bot.
3. When the Vercel cron triggers (or trigger `/api/cron/sync-drive` manually), the bot will discover the new file, analyze it, and send a proactive notification:
   > 🔔 **New files detected in your Google Drive folder!**  
   > • `CV391.pdf`  
   > ⏳ Starting automatic analysis...

### Test 5: Duplicate Prevention
- Trigger the sync endpoint multiple times.
- Verify that already analyzed files (`isDriveFileProcessed`) are skipped with zero redundant analysis.

### Test 6: Multi-User Isolation
- When User A and User B connect different folders, their documents, candidate rankings, and Q&A context remain completely isolated.
