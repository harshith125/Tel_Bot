import { Bot, Context, session, SessionFlavor } from "grammy";
import {
  extractResumesFromZip,
  isSupportedDocument,
  parseUploadedFile,
  ParsedDocument,
} from "./document-parser";
import { analyzeResume, askQuestion } from "./gemini";
import type { ResumeAnalysis } from "../types/analysis";

interface SessionData {
  jobDescriptions: ParsedDocument[];
  resumes: ParsedDocument[];
  analysisResults: ResumeAnalysis[] | null;
  uploadMode: "jd" | "resume" | "auto";
}

export type MyContext = Context & SessionFlavor<SessionData>;

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.warn("TELEGRAM_BOT_TOKEN is missing. Bot will not start.");
}

export const bot = new Bot<MyContext>(token || "dummy");

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
  const url = `https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`;
  const res = await fetch(url);
  const data = await res.json();
  
  if (!data.ok) {
    throw new Error(`Failed to get file info: ${data.description}`);
  }
  
  const filePath = data.result.file_path;
  const downloadUrl = `https://api.telegram.org/file/bot${token}/${filePath}`;
  
  const fileRes = await fetch(downloadUrl);
  if (!fileRes.ok) {
    throw new Error(`Failed to download file: ${fileRes.statusText}`);
  }
  
  const arrayBuffer = await fileRes.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// ---------------------------------------------------------------------------
// 1. COMMANDS (Must be registered BEFORE general text handlers)
// ---------------------------------------------------------------------------

bot.command("start", async (ctx) => {
  await ctx.reply(
    "Welcome to the AI Resume Analyzer Bot!\n\n" +
    "1. First, send me a Job Description (JD) by either pasting the text directly or uploading a PDF/DOCX.\n" +
    "2. Then, send me one or more resumes as PDF, DOCX, or a ZIP folder.\n" +
    "3. Finally, send /analyze to get the matching scores and feedback.\n" +
    "4. Ask questions! After analysis, just type a question and I will answer based on the candidates.\n\n" +
    "💡 *Tip:* To analyze against multiple JDs, type /addjd to upload more JDs, then /addresume to upload resumes.\n\n" +
    "Send /reset at any time to clear your uploaded documents."
  );
});

bot.command("addjd", async (ctx) => {
  ctx.session.uploadMode = "jd";
  await ctx.reply("📁 Mode set to <b>Job Descriptions</b>. Next documents you upload will be treated as JDs.", { parse_mode: "HTML" });
});

bot.command("addresume", async (ctx) => {
  ctx.session.uploadMode = "resume";
  await ctx.reply("📄 Mode set to <b>Resumes</b>. Next documents you upload will be treated as Resumes.", { parse_mode: "HTML" });
});

bot.command("reset", async (ctx) => {
  ctx.session.jobDescriptions = [];
  ctx.session.resumes = [];
  ctx.session.analysisResults = null;
  ctx.session.uploadMode = "auto";
  await ctx.reply("Session reset. Please send a new Job Description.");
});

bot.command("status", async (ctx) => {
  const jdsCount = ctx.session.jobDescriptions.length;
  const resumesCount = ctx.session.resumes.length;
  await ctx.reply(
    `📊 <b>Current Status</b>\n\n` +
    `<b>JDs Uploaded:</b> ${jdsCount}\n` +
    `<b>Resumes Uploaded:</b> ${resumesCount}\n` +
    `<b>Analyzed:</b> ${ctx.session.analysisResults ? "Yes" : "No"}\n\n` +
    (jdsCount > 0 && resumesCount > 0 
      ? "Ready to /analyze!" 
      : "Please upload the missing documents."),
    { parse_mode: "HTML" }
  );
});

bot.command("analyze", async (ctx) => {
  const { jobDescriptions, resumes } = ctx.session;
  
  if (jobDescriptions.length === 0) {
    await ctx.reply("❌ Please provide at least one Job Description first.");
    return;
  }
  
  if (resumes.length === 0) {
    await ctx.reply("❌ Please upload at least one resume first.");
    return;
  }
  
  const statusMsg = await ctx.reply(`🔍 Starting analysis of ${resumes.length} resume(s) against ${jobDescriptions.length} JD(s)... This might take a few minutes.`);
  
  // Clear previous results
  ctx.session.analysisResults = [];
  
  for (let j = 0; j < jobDescriptions.length; j++) {
    const jd = jobDescriptions[j];
    await ctx.reply(`📋 <b>Analyzing for Role:</b> ${jd.filename}`, { parse_mode: "HTML" });
    
    const results: ResumeAnalysis[] = [];
    let modelUsed = "";
    
    for (let i = 0; i < resumes.length; i++) {
      const resume = resumes[i];
      
      let success = false;
      let retries = 3;
      
      while (!success && retries > 0) {
        try {
          if (i > 0 || j > 0) {
            // Small 500ms delay to prevent socket flooding (instead of 4000ms!)
            await new Promise(resolve => setTimeout(resolve, 500));
          }
          
          await ctx.api.editMessageText(
            ctx.chat.id, 
            statusMsg.message_id, 
            `⏳ Analyzing JD ${j + 1}/${jobDescriptions.length} | Resume ${i + 1}/${resumes.length} (${resume.filename})... Please wait.`
          ).catch(() => {}); // Ignore duplicate text edit errors
          
          const analysis = await analyzeResume(jd.text, resume.filename, resume.text);
          results.push(analysis.result);
          modelUsed = analysis.modelUsed;
          success = true;
          
        } catch (error: any) {
          if (error?.status === 429 || error?.message?.includes("429")) {
            console.log(`Rate limited on ${resume.filename}. Retrying in 5 seconds...`);
            await new Promise(r => setTimeout(r, 5000));
            retries--;
            if (retries === 0) {
              await ctx.reply(`⚠️ Skipped ${resume.filename} due to strict rate limits.`);
            }
          } else {
            console.error(`Error analyzing ${resume.filename}:`, error);
            const message = error instanceof Error ? error.message : "Unknown Gemini error";
            await ctx.reply(`⚠️ Failed to analyze ${resume.filename}: ${message}`);
            break;
          }
        }
      }
    }
    
    // Sort and output for this JD
    if (results.length > 0) {
      results.sort((a, b) => b.overallScore - a.overallScore);
      
      // Store globally for Q&A
      ctx.session.analysisResults.push(...results);
      
      let summaryText = `📊 <b>Candidate Ranking</b> (Model: ${modelUsed})\n<b>Role:</b> ${jd.filename}\n\n`;
      results.forEach((res, index) => {
        summaryText += `${index + 1}. <b>${res.candidateName || res.resumeFilename}</b> - Score: ${res.overallScore}/100\n`;
      });
      
      await ctx.reply(summaryText, { parse_mode: "HTML" });
      
      for (const res of results) {
        const missing = res.missingSkills?.length > 0 ? res.missingSkills.join(", ") : "None detected.";
        const expSuggestions = res.suggestedResume?.experienceSuggestions?.map(s => `• ${s}`).join("\n") || "No specific experience suggestions.";
        
        const details = 
          `👤 <b>${res.candidateName || res.resumeFilename}</b> (${res.overallScore}/100 - ${res.recommendation})\n` +
          `<i>Role: ${jd.filename}</i>\n\n` +
          `<b>Evaluator's Reasoning:</b>\n${res.evaluationReasoning || "No reasoning provided."}\n\n` +
          `<b>Missing from JD:</b>\n${missing}\n\n` +
          `<b>Suggestions to Improve:</b>\n${expSuggestions}`;
          
        await ctx.reply(details, { parse_mode: "HTML" });
      }
    }
  }

  await ctx.api.editMessageText(
    ctx.chat.id, 
    statusMsg.message_id, 
    `✅ Analysis complete!`
  ).catch(() => {});
  
  await ctx.reply("💡 <i>Tip:</i> You can now ask me any questions about these candidates! Just type your question.", { parse_mode: "HTML" });
});

// ---------------------------------------------------------------------------
// 2. MESSAGE HANDLERS
// ---------------------------------------------------------------------------

bot.on("message:document", async (ctx) => {
  const doc = ctx.message.document;
  const filename = doc.file_name || "document";
  const ext = filename.lastIndexOf(".") !== -1 ? filename.slice(filename.lastIndexOf(".")).toLowerCase() : "";
  
  try {
    const loadingMessage = await ctx.reply(`Downloading ${filename}...`);
    const buffer = await downloadTelegramFile(doc.file_id);
    let isJdMode = false;
    if (ctx.session.uploadMode === "jd") {
      isJdMode = true;
    } else if (ctx.session.uploadMode === "resume") {
      isJdMode = false;
    } else {
      // auto mode
      if (ctx.session.jobDescriptions.length === 0) {
        isJdMode = true;
      }
    }
    
    if (ext === ".pdf" || ext === ".docx") {
      const parsed = await parseUploadedFile(filename, buffer);
      if (isJdMode) {
        ctx.session.jobDescriptions.push(parsed);
        await ctx.api.editMessageText(
          ctx.chat.id, 
          loadingMessage.message_id, 
          `✅ Job Description added: ${filename}\nTotal JDs: ${ctx.session.jobDescriptions.length}. Type /addresume to upload resumes, or /analyze.`
        );
      } else {
        ctx.session.resumes.push(parsed);
        ctx.session.analysisResults = null;
        await ctx.api.editMessageText(
          ctx.chat.id, 
          loadingMessage.message_id, 
          `✅ Resume added: ${filename}\nTotal resumes: ${ctx.session.resumes.length}. Send more or type /analyze.`
        );
      }
    } else if (ext === ".zip") {
      const extracted = await extractResumesFromZip(buffer);
      
      if (isJdMode) {
        ctx.session.jobDescriptions.push(...extracted);
        await ctx.api.editMessageText(
          ctx.chat.id, 
          loadingMessage.message_id, 
          `✅ Extracted and added ${extracted.length} JDs from the ZIP folder.\nTotal JDs: ${ctx.session.jobDescriptions.length}. Type /addresume to upload resumes, or /analyze.`
        );
      } else {
        ctx.session.resumes.push(...extracted);
        ctx.session.analysisResults = null;
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
  const text = ctx.message.text;
  
  if (text.startsWith("/")) return; // Ignore unhandled commands
  
  // If analysis is done and it's a short message, treat as a question
  if (ctx.session.analysisResults && ctx.session.analysisResults.length > 0) {
    // Treat as Q&A
    try {
      const waitMsg = await ctx.reply("🤔 Thinking...");
      const allJDs = ctx.session.jobDescriptions.map(jd => `--- JD: ${jd.filename} ---\n${jd.text}`).join("\n\n");
      const answer = await askQuestion(
        text, 
        allJDs, 
        ctx.session.analysisResults,
        ctx.session.resumes
      );
      await ctx.api.editMessageText(ctx.chat.id, waitMsg.message_id, answer, { parse_mode: "HTML" });
    } catch (error) {
      console.error(error);
      await ctx.reply("❌ Sorry, I encountered an error while answering that.");
    }
    return;
  }
  
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

  // If no analysis is done, treat long text as JD (or Resume if in resume mode)
  if (text.length < 50) {
    await ctx.reply("If you are asking a question, please run /analyze first.\nIf you are pasting a document, it must be longer than 50 characters.");
    return;
  }
  
  if (isJdMode) {
    ctx.session.jobDescriptions.push({ filename: "Pasted Text", text });
    await ctx.reply(`✅ Job Description added from text.\nTotal JDs: ${ctx.session.jobDescriptions.length}. Type /addresume to upload resumes, or /analyze.`);
  } else {
    ctx.session.resumes.push({ filename: "Pasted Text", text });
    ctx.session.analysisResults = null;
    await ctx.reply(`✅ Resume added from text.\nTotal resumes: ${ctx.session.resumes.length}. Send more or type /analyze.`);
  }
});
