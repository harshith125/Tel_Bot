import { Bot, Context, session, SessionFlavor } from "grammy";
import {
  extractResumesFromZip,
  isSupportedDocument,
  parseUploadedFile,
  ParsedDocument,
  extractDocumentText,
} from "./document-parser";
import { analyzeResume, askQuestion } from "./gemini";
import { ensureUniqueCandidateIds, extractCandidateId } from "./candidate-utils";
import {
  parseDriveUrl,
  downloadDriveFile,
  getDriveFileMetadata,
  listFilesInFolder,
  classifyDocumentType,
} from "./drive";
import {
  saveFolderConnection,
  getUserFolderConnections,
  deleteFolderConnection,
  saveUserManualDocument,
  saveUserAnalysisResults,
  getUserAnalysisResults,
  getUserCombinedJDs,
  getUserCombinedResumes,
  clearUserData,
  DriveFolderConnection,
} from "./db";
import { syncFolderConnection } from "./sync-engine";
import type { ResumeAnalysis } from "../types/analysis";

interface SessionData {
  jobDescriptions: ParsedDocument[];
  resumes: ParsedDocument[];
  analysisResults: ResumeAnalysis[] | null;
  uploadMode: "jd" | "resume" | "auto";
}

export type MyContext = Context & SessionFlavor<SessionData>;

function getBotToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN is missing in environment variables.");
  }
  return token;
}

export const bot = new Bot<MyContext>(process.env.TELEGRAM_BOT_TOKEN || "dummy_token_for_build");

bot.use(
  session({
    initial: (): SessionData => ({
      jobDescriptions: [],
      resumes: [],
      analysisResults: null,
      uploadMode: "auto",
    }),
  })
);

async function downloadTelegramFile(fileId: string): Promise<Buffer> {
  const token = getBotToken();
  const url = `https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`;
  
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    throw new Error("Failed to reach Telegram API for file information.");
  }
  
  const data = await res.json().catch(() => null);
  if (!data || !data.ok) {
    throw new Error(`Failed to get file info: ${data?.description || "Unknown Telegram API error"}`);
  }
  
  const filePath = data.result?.file_path;
  if (!filePath) {
    throw new Error("No file path returned by Telegram.");
  }
  
  const downloadUrl = `https://api.telegram.org/file/bot${token}/${filePath}`;
  let fileRes: Response;
  try {
    fileRes = await fetch(downloadUrl);
  } catch {
    throw new Error("Failed to download file content from Telegram.");
  }
  
  if (!fileRes.ok) {
    throw new Error(`Failed to download file from Telegram (Status ${fileRes.status})`);
  }
  
  const arrayBuffer = await fileRes.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// ---------------------------------------------------------------------------
// 1. COMMANDS
// ---------------------------------------------------------------------------

bot.command("start", async (ctx) => {
  await ctx.reply(
    "👋 <b>Welcome to HireMatrix AI!</b>\n\n" +
      "I analyze job descriptions (JDs) and candidate resumes (CVs) with automated scoring, ranking, and intelligent Q&A.\n\n" +
      "<b>Supported Input Methods:</b>\n" +
      "• 📄 <b>Direct File Uploads:</b> PDF, DOCX, or bulk ZIP folder\n" +
      "• 🔗 <b>Google Drive File:</b> Paste a Google Drive file link\n" +
      "• 📁 <b>Google Drive Folder:</b> Paste a Drive folder link for continuous auto-sync\n" +
      "• 📝 <b>Pasted Text:</b> Paste JD or resume text directly\n\n" +
      "<b>Commands:</b>\n" +
      "• /analyze — Start AI evaluation and ranking\n" +
      "• /status — View currently uploaded & connected files\n" +
      "• /folders — View connected Google Drive folders\n" +
      "• /sync — Manually synchronize connected Google Drive folders\n" +
      "• /addjd — Switch mode to upload Job Descriptions\n" +
      "• /addresume — Switch mode to upload Resumes\n" +
      "• /reset — Clear all session documents and disconnect folders",
    { parse_mode: "HTML" }
  );
});

bot.command("addjd", async (ctx) => {
  ctx.session.uploadMode = "jd";
  await ctx.reply("📁 Mode set to <b>Job Descriptions</b>. Next documents or Drive links will be treated as JDs.", { parse_mode: "HTML" });
});

bot.command("addresume", async (ctx) => {
  ctx.session.uploadMode = "resume";
  await ctx.reply("📄 Mode set to <b>Resumes</b>. Next documents or Drive links will be treated as Resumes.", { parse_mode: "HTML" });
});

bot.command("reset", async (ctx) => {
  const userId = String(ctx.from?.id || "");
  ctx.session.jobDescriptions = [];
  ctx.session.resumes = [];
  ctx.session.analysisResults = null;
  ctx.session.uploadMode = "auto";
  if (userId) {
    clearUserData(userId);
  }
  await ctx.reply("🔄 Session reset. All uploaded documents and Drive connections cleared.");
});

bot.command("folders", async (ctx) => {
  const userId = String(ctx.from?.id || "");
  const connections = getUserFolderConnections(userId);

  if (connections.length === 0) {
    await ctx.reply("ℹ️ No Google Drive folders currently connected. Simply send a Drive folder link to connect one!");
    return;
  }

  let text = `📁 <b>Connected Google Drive Folders (${connections.length})</b>\n\n`;
  connections.forEach((c, idx) => {
    const lastSync = c.lastSyncedAt ? new Date(c.lastSyncedAt).toLocaleString() : "Pending sync";
    text += `${idx + 1}. <b>Folder ID:</b> <code>${c.folderId}</code>\n` +
            `   <b>Mode:</b> ${c.uploadMode}\n` +
            `   <b>Last Synced:</b> ${lastSync}\n` +
            `   <i>To disconnect:</i> /disconnect_${c.folderId}\n\n`;
  });

  await ctx.reply(text, { parse_mode: "HTML" });
});

bot.command("sync", async (ctx) => {
  const userId = String(ctx.from?.id || "");
  const connections = getUserFolderConnections(userId);

  if (connections.length === 0) {
    await ctx.reply("ℹ️ No connected Google Drive folders found. Send a Google Drive folder link to connect one.");
    return;
  }

  const waitMsg = await ctx.reply(`🔄 Synchronizing ${connections.length} connected Google Drive folder(s)...`);

  let totalNew = 0;
  for (const conn of connections) {
    try {
      const res = await syncFolderConnection(conn, bot, false);
      totalNew += res.newFilesProcessedCount;
    } catch (err) {
      console.error(`Error syncing folder ${conn.folderId}:`, err);
    }
  }

  await ctx.api.editMessageText(
    ctx.chat.id,
    waitMsg.message_id,
    `✅ <b>Sync complete!</b>\n\n${totalNew} new or updated file(s) processed.`,
    { parse_mode: "HTML" }
  ).catch(() => {});
});

bot.command("status", async (ctx) => {
  const userId = String(ctx.from?.id || "");
  const combinedJds = getUserCombinedJDs(userId);
  const combinedResumes = getUserCombinedResumes(userId);
  const connections = getUserFolderConnections(userId);
  const storedResults = getUserAnalysisResults(userId);

  const hasAnalysis = Boolean((ctx.session.analysisResults && ctx.session.analysisResults.length > 0) || storedResults.length > 0);

  await ctx.reply(
    `📊 <b>Current Status</b>\n\n` +
      `<b>JDs Available:</b> ${combinedJds.length || ctx.session.jobDescriptions.length}\n` +
      `<b>Resumes Available:</b> ${combinedResumes.length || ctx.session.resumes.length}\n` +
      `<b>Connected Drive Folders:</b> ${connections.length}\n` +
      `<b>Analyzed:</b> ${hasAnalysis ? "Yes" : "No"}\n\n` +
      (combinedJds.length > 0 && combinedResumes.length > 0
        ? "Ready to /analyze or ask questions!"
        : "Please upload or link the missing JDs or Resumes."),
    { parse_mode: "HTML" }
  );
});

bot.command("analyze", async (ctx) => {
  const userId = String(ctx.from?.id || "");

  // Merge session with persistent DB documents
  const allJds = getUserCombinedJDs(userId);
  const allResumes = getUserCombinedResumes(userId);

  // If session has items not yet in DB, merge them
  const jdsMap = new Map<string, ParsedDocument>();
  allJds.forEach((j) => jdsMap.set(j.filename, j));
  ctx.session.jobDescriptions.forEach((j) => jdsMap.set(j.filename, j));
  const finalJds = Array.from(jdsMap.values());

  const resumesMap = new Map<string, ParsedDocument>();
  allResumes.forEach((r) => resumesMap.set(r.filename, r));
  ctx.session.resumes.forEach((r) => resumesMap.set(r.filename, r));
  const finalResumes = ensureUniqueCandidateIds(Array.from(resumesMap.values()));

  if (finalJds.length === 0) {
    await ctx.reply("❌ Please provide at least one Job Description (upload PDF/DOCX, paste text, or send Google Drive link).");
    return;
  }

  if (finalResumes.length === 0) {
    await ctx.reply("❌ Please upload or link at least one candidate resume first.");
    return;
  }

  const statusMsg = await ctx.reply(
    `🔍 Starting analysis of ${finalResumes.length} candidate(s) against ${finalJds.length} role(s)... This might take a few moments.`
  );

  ctx.session.analysisResults = [];
  const allGeneratedResults: ResumeAnalysis[] = [];

  for (let j = 0; j < finalJds.length; j++) {
    const jd = finalJds[j];
    await ctx.reply(`📋 <b>Analyzing for Role:</b> ${jd.filename}`, { parse_mode: "HTML" });

    const results: ResumeAnalysis[] = [];
    let modelUsed = "";

    for (let i = 0; i < finalResumes.length; i++) {
      const resume = finalResumes[i];
      let success = false;
      let retries = 3;

      while (!success && retries > 0) {
        try {
          if (i > 0 || j > 0) {
            await new Promise((resolve) => setTimeout(resolve, 400));
          }

          await ctx.api
            .editMessageText(
              ctx.chat.id,
              statusMsg.message_id,
              `⏳ Analyzing Role ${j + 1}/${finalJds.length} | Candidate ${i + 1}/${finalResumes.length} (${resume.candidateId || resume.filename})...`
            )
            .catch(() => {});

          const analysis = await analyzeResume(
            jd.text,
            resume.filename,
            resume.text,
            resume.candidateId
          );
          results.push(analysis.result);
          allGeneratedResults.push(analysis.result);
          modelUsed = analysis.modelUsed;
          success = true;
        } catch (error: any) {
          if (error?.status === 429 || error?.message?.includes("429")) {
            console.log(`Rate limited on ${resume.filename}. Retrying in 5s...`);
            await new Promise((r) => setTimeout(r, 5000));
            retries--;
            if (retries === 0) {
              await ctx.reply(`⚠️ Skipped ${resume.filename} due to rate limits.`);
            }
          } else {
            console.error(`Error analyzing ${resume.filename}:`, error);
            const msg = error instanceof Error ? error.message : "Unknown error";
            await ctx.reply(`⚠️ Failed to analyze ${resume.filename}: ${msg}`);
            break;
          }
        }
      }
    }

    if (results.length > 0) {
      results.sort((a, b) => b.overallScore - a.overallScore);
      ctx.session.analysisResults.push(...results);

      let summaryText = `📊 <b>Candidate Ranking</b> (Model: ${modelUsed})\n<b>Role:</b> ${jd.filename}\n\n`;
      results.forEach((res, index) => {
        summaryText += `${index + 1}. <b>${res.displayName}</b> — Score: ${res.overallScore}/100\n`;
      });

      await ctx.reply(summaryText, { parse_mode: "HTML" });

      for (const res of results) {
        const missing = res.missingSkills?.length > 0 ? res.missingSkills.join(", ") : "None detected.";
        const expSuggestions =
          res.suggestedResume?.experienceSuggestions?.map((s) => `• ${s}`).join("\n") ||
          "No specific experience suggestions.";

        const details =
          `👤 <b>Candidate:</b> ${res.displayName}\n` +
          `<b>Score:</b> ${res.overallScore}/100 — ${res.recommendation}\n` +
          `<i>Role: ${jd.filename}</i>\n\n` +
          `<b>Evaluator's Reasoning:</b>\n${res.evaluationReasoning || "No reasoning provided."}\n\n` +
          `<b>Missing from JD:</b>\n${missing}\n\n` +
          `<b>Suggestions to Improve:</b>\n${expSuggestions}`;

        await ctx.reply(details, { parse_mode: "HTML" });
      }
    }
  }

  if (userId && allGeneratedResults.length > 0) {
    saveUserAnalysisResults(userId, allGeneratedResults);
  }

  await ctx.api.editMessageText(ctx.chat.id, statusMsg.message_id, `✅ Analysis complete!`).catch(() => {});
  await ctx.reply("💡 <i>Tip:</i> You can now ask questions about these candidates! Just type your question.", {
    parse_mode: "HTML",
  });
});

// ---------------------------------------------------------------------------
// 2. MESSAGE HANDLERS
// ---------------------------------------------------------------------------

bot.on("message:document", async (ctx) => {
  const doc = ctx.message.document;
  const filename = doc.file_name || "document";
  const ext = filename.lastIndexOf(".") !== -1 ? filename.slice(filename.lastIndexOf(".")).toLowerCase() : "";
  const userId = String(ctx.from?.id || "");

  try {
    const loadingMessage = await ctx.reply(`Downloading ${filename}...`);
    const buffer = await downloadTelegramFile(doc.file_id);
    let isJdMode = false;
    if (ctx.session.uploadMode === "jd") {
      isJdMode = true;
    } else if (ctx.session.uploadMode === "resume") {
      isJdMode = false;
    } else {
      if (ctx.session.jobDescriptions.length === 0) {
        isJdMode = true;
      }
    }

    if (ext === ".pdf" || ext === ".docx") {
      const parsed = await parseUploadedFile(
        filename,
        buffer,
        isJdMode ? undefined : ctx.session.resumes.length
      );

      if (isJdMode) {
        ctx.session.jobDescriptions.push(parsed);
        if (userId) saveUserManualDocument(userId, parsed, "JD");
        await ctx.api.editMessageText(
          ctx.chat.id,
          loadingMessage.message_id,
          `✅ Job Description added: ${filename}\nTotal JDs: ${ctx.session.jobDescriptions.length}. Type /addresume to upload resumes, or /analyze.`
        );
      } else {
        ctx.session.resumes.push(parsed);
        ctx.session.analysisResults = null;
        if (userId) saveUserManualDocument(userId, parsed, "RESUME");
        await ctx.api.editMessageText(
          ctx.chat.id,
          loadingMessage.message_id,
          `✅ Resume added: ${filename} (Candidate ID: ${parsed.candidateId || "Auto"})\nTotal resumes: ${ctx.session.resumes.length}. Send more or type /analyze.`
        );
      }
    } else if (ext === ".zip") {
      const extracted = await extractResumesFromZip(buffer);

      if (isJdMode) {
        ctx.session.jobDescriptions.push(...extracted);
        if (userId) extracted.forEach((d) => saveUserManualDocument(userId, d, "JD"));
        await ctx.api.editMessageText(
          ctx.chat.id,
          loadingMessage.message_id,
          `✅ Extracted and added ${extracted.length} JDs from the ZIP folder.\nTotal JDs: ${ctx.session.jobDescriptions.length}. Type /addresume to upload resumes, or /analyze.`
        );
      } else {
        ctx.session.resumes.push(...extracted);
        ctx.session.analysisResults = null;
        if (userId) extracted.forEach((d) => saveUserManualDocument(userId, d, "RESUME"));
        await ctx.api.editMessageText(
          ctx.chat.id,
          loadingMessage.message_id,
          `✅ Extracted and added ${extracted.length} resumes from the ZIP folder.\nTotal resumes: ${ctx.session.resumes.length}. Send more or type /analyze.`
        );
      }
    } else {
      await ctx.api.editMessageText(
        ctx.chat.id,
        loadingMessage.message_id,
        `❌ Unsupported file type: ${ext}. Please send PDF, DOCX, or ZIP.`
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await ctx.reply(`❌ Failed to process ${filename}: ${message}`);
  }
});

bot.on("message:text", async (ctx) => {
  const text = ctx.message.text.trim();
  const userId = String(ctx.from?.id || "");

  // Handle dynamic /disconnect_<folder_id>
  if (text.startsWith("/disconnect_") || text.startsWith("/disconnect")) {
    const parts = text.split(/[\s_]+/);
    const folderId = parts[1];
    if (!folderId) {
      await ctx.reply("Usage: /disconnect_<FOLDER_ID> or /disconnect <FOLDER_ID>");
      return;
    }
    const removed = deleteFolderConnection(userId, folderId);
    if (removed) {
      await ctx.reply(`✅ Disconnected Google Drive folder <code>${folderId}</code>.`, { parse_mode: "HTML" });
    } else {
      await ctx.reply(`❌ Folder <code>${folderId}</code> was not found among your connected folders.`, { parse_mode: "HTML" });
    }
    return;
  }

  if (text.startsWith("/")) return; // Ignore other unhandled slash commands

  // -------------------------------------------------------------------------
  // A. GOOGLE DRIVE LINK DETECTION (File or Folder)
  // -------------------------------------------------------------------------
  const driveUrl = parseDriveUrl(text);
  if (driveUrl) {
    if (driveUrl.type === "file") {
      const waitMsg = await ctx.reply("🔍 <b>Google Drive file detected.</b> Verifying access and downloading...", {
        parse_mode: "HTML",
      });

      try {
        const meta = await getDriveFileMetadata(driveUrl.id);
        const buffer = await downloadDriveFile(driveUrl.id);
        const parsedText = await extractDocumentText(meta.name, buffer);

        const docType = classifyDocumentType(meta.name, ctx.session.uploadMode);
        const candidateId = docType === "RESUME" ? extractCandidateId(meta.name) : undefined;

        const doc: ParsedDocument = {
          filename: meta.name,
          text: parsedText,
          candidateId,
        };

        if (docType === "JD") {
          ctx.session.jobDescriptions.push(doc);
          if (userId) saveUserManualDocument(userId, doc, "JD");
          await ctx.api.editMessageText(
            ctx.chat.id,
            waitMsg.message_id,
            `✅ <b>Job Description added from Google Drive:</b> ${meta.name}\nTotal JDs: ${ctx.session.jobDescriptions.length}. Send resumes or type /analyze.`,
            { parse_mode: "HTML" }
          );
        } else {
          ctx.session.resumes.push(doc);
          ctx.session.analysisResults = null;
          if (userId) saveUserManualDocument(userId, doc, "RESUME");
          await ctx.api.editMessageText(
            ctx.chat.id,
            waitMsg.message_id,
            `✅ <b>Resume added from Google Drive:</b> ${meta.name} (Candidate ID: ${candidateId || "Auto"})\nTotal resumes: ${ctx.session.resumes.length}. Send more or type /analyze.`,
            { parse_mode: "HTML" }
          );
        }
      } catch (err) {
        console.error("Failed to process Google Drive file link:", err);
        const msg = err instanceof Error ? err.message : String(err);
        await ctx.api.editMessageText(
          ctx.chat.id,
          waitMsg.message_id,
          `❌ <b>Failed to process Google Drive file:</b> ${msg}\n\n<i>Tip: Ensure the file is shared with the Bot's Service Account email or link sharing is set to 'Anyone with the link'.</i>`,
          { parse_mode: "HTML" }
        );
      }
      return;
    }

    if (driveUrl.type === "folder") {
      const waitMsg = await ctx.reply("📁 <b>Google Drive folder detected.</b> Connecting and scanning files...", {
        parse_mode: "HTML",
      });

      try {
        const files = await listFilesInFolder(driveUrl.id);
        const jds = files.filter((f) => classifyDocumentType(f.name, ctx.session.uploadMode) === "JD");
        const resumes = files.filter((f) => classifyDocumentType(f.name, ctx.session.uploadMode) === "RESUME");

        const conn: DriveFolderConnection = {
          id: `${userId}_${driveUrl.id}`,
          telegramUserId: userId,
          chatId: String(ctx.chat.id),
          folderId: driveUrl.id,
          connectedAt: new Date().toISOString(),
          uploadMode: ctx.session.uploadMode,
        };

        saveFolderConnection(conn);

        await ctx.api.editMessageText(
          ctx.chat.id,
          waitMsg.message_id,
          `📁 <b>Google Drive folder connected.</b>\n\n` +
            `<b>Found:</b>\n` +
            `JDs: ${jds.length}\n` +
            `Resumes: ${resumes.length}\n\n` +
            `⏳ Starting analysis...`,
          { parse_mode: "HTML" }
        );

        // Run initial synchronization and analysis
        const syncResult = await syncFolderConnection(conn, bot, true);

        // Load into session for interactive Q&A
        const userJds = getUserCombinedJDs(userId);
        const userResumes = getUserCombinedResumes(userId);
        const userResults = getUserAnalysisResults(userId);

        ctx.session.jobDescriptions = userJds;
        ctx.session.resumes = userResumes;
        ctx.session.analysisResults = userResults;

        let completionText = `✅ <b>Folder connected & analyzed!</b>\n\n` +
          `<b>Processed Documents:</b> ${syncResult.newFilesProcessedCount}\n` +
          `• JDs: ${syncResult.jdsCount}\n` +
          `• Resumes: ${syncResult.resumesCount}\n\n`;

        if (userResults.length > 0) {
          completionText += `📊 <b>Candidate Ranking:</b>\n`;
          userResults
            .slice()
            .sort((a, b) => b.overallScore - a.overallScore)
            .forEach((res, idx) => {
              completionText += `${idx + 1}. <b>${res.displayName}</b> — Score: ${res.overallScore}/100\n`;
            });
        }

        completionText += `\n💡 <i>New files added to this folder will be automatically detected and analyzed!</i>`;

        await ctx.reply(completionText, { parse_mode: "HTML" });
      } catch (err) {
        console.error("Failed to connect Google Drive folder:", err);
        const msg = err instanceof Error ? err.message : String(err);
        await ctx.api.editMessageText(
          ctx.chat.id,
          waitMsg.message_id,
          `❌ <b>Failed to connect Google Drive folder:</b> ${msg}\n\n<i>Tip: Share the folder with the Bot's Service Account email with Viewer access.</i>`,
          { parse_mode: "HTML" }
        );
      }
      return;
    }
  }

  // -------------------------------------------------------------------------
  // B. INTERACTIVE Q&A (if analysis results exist)
  // -------------------------------------------------------------------------
  const userResults = getUserAnalysisResults(userId);
  const activeResults = ctx.session.analysisResults || (userResults.length > 0 ? userResults : null);

  if (activeResults && activeResults.length > 0) {
    let waitMsg: any;
    try {
      waitMsg = await ctx.reply("🤔 Thinking...");
      const allJDsList = getUserCombinedJDs(userId);
      const allResumesList = getUserCombinedResumes(userId);

      const jdsForPrompt = (allJDsList.length > 0 ? allJDsList : ctx.session.jobDescriptions)
        .map((jd) => `--- JD: ${jd.filename} ---\n${jd.text}`)
        .join("\n\n");

      const resumesForPrompt = allResumesList.length > 0 ? allResumesList : ctx.session.resumes;

      const answer = await askQuestion(text, jdsForPrompt, activeResults, resumesForPrompt);

      try {
        await ctx.api.editMessageText(ctx.chat.id, waitMsg.message_id, answer, { parse_mode: "HTML" });
      } catch {
        await ctx.api.editMessageText(ctx.chat.id, waitMsg.message_id, answer).catch(async () => {
          await ctx.reply(answer);
        });
      }
    } catch (error) {
      console.error("Q&A Error:", error);
      if (waitMsg?.message_id) {
        await ctx.api
          .editMessageText(
            ctx.chat.id,
            waitMsg.message_id,
            "❌ Sorry, I encountered an error while answering that. Please try asking again."
          )
          .catch(() => {});
      } else {
        await ctx.reply("❌ Sorry, I encountered an error while answering that. Please try asking again.");
      }
    }
    return;
  }

  // -------------------------------------------------------------------------
  // C. PASTED TEXT (JD or Resume)
  // -------------------------------------------------------------------------
  let isJdMode = false;
  if (ctx.session.uploadMode === "jd") {
    isJdMode = true;
  } else if (ctx.session.uploadMode === "resume") {
    isJdMode = false;
  } else {
    if (ctx.session.jobDescriptions.length === 0) {
      isJdMode = true;
    }
  }

  if (text.length < 50) {
    await ctx.reply(
      "If you are asking a question, please run /analyze first.\n" +
        "If you are pasting a document, it must be longer than 50 characters.\n" +
        "To connect Google Drive, paste a valid Google Drive file or folder URL."
    );
    return;
  }

  if (isJdMode) {
    const doc: ParsedDocument = { filename: "Pasted Text JD", text };
    ctx.session.jobDescriptions.push(doc);
    if (userId) saveUserManualDocument(userId, doc, "JD");
    await ctx.reply(
      `✅ Job Description added from text.\nTotal JDs: ${ctx.session.jobDescriptions.length}. Type /addresume to upload resumes, or /analyze.`
    );
  } else {
    const candidateId = `CV${ctx.session.resumes.length + 1}`;
    const doc: ParsedDocument = {
      filename: `Pasted Text (${candidateId})`,
      text,
      candidateId,
    };
    ctx.session.resumes.push(doc);
    ctx.session.analysisResults = null;
    if (userId) saveUserManualDocument(userId, doc, "RESUME");
    await ctx.reply(
      `✅ Resume added from text (${candidateId}).\nTotal resumes: ${ctx.session.resumes.length}. Send more or type /analyze.`
    );
  }
});
