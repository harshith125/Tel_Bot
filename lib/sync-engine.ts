import { Bot } from "grammy";
import {
  downloadDriveFile,
  listFilesInFolder,
  classifyDocumentType,
  DriveItemMetadata,
} from "./drive";
import {
  DriveFolderConnection,
  DriveFileRecord,
  getAllFolderConnections,
  getUserFolderConnections,
  isDriveFileProcessed,
  saveDriveFile,
  saveFolderConnection,
  saveUserAnalysisResults,
  getUserCombinedJDs,
  getUserCombinedResumes,
} from "./db";
import { extractDocumentText } from "./document-parser";
import { extractCandidateId } from "./candidate-utils";
import { analyzeResume } from "./gemini";
import type { ResumeAnalysis } from "@/types/analysis";

export interface SyncResult {
  folderId: string;
  telegramUserId: string;
  foundFilesCount: number;
  newFilesProcessedCount: number;
  jdsCount: number;
  resumesCount: number;
  errors: string[];
}

export async function processSingleDriveFile(
  fileMeta: DriveItemMetadata,
  conn: DriveFolderConnection,
  botInstance?: Bot<any>
): Promise<DriveFileRecord> {
  const docType = classifyDocumentType(fileMeta.name, conn.uploadMode);
  const candidateId = docType === "RESUME" ? extractCandidateId(fileMeta.name) : undefined;

  const record: DriveFileRecord = {
    driveFileId: fileMeta.id,
    folderId: conn.folderId,
    telegramUserId: conn.telegramUserId,
    chatId: conn.chatId,
    fileName: fileMeta.name,
    mimeType: fileMeta.mimeType,
    modifiedTime: fileMeta.modifiedTime,
    processedAt: new Date().toISOString(),
    documentType: docType,
    candidateId,
    status: "processing",
  };

  try {
    const buffer = await downloadDriveFile(fileMeta.id);
    const text = await extractDocumentText(fileMeta.name, buffer);

    if (!text || text.trim().length === 0) {
      throw new Error("No readable text found in document.");
    }

    record.parsedText = text;

    // If it's a resume and there are existing JDs for this user, analyze it
    if (docType === "RESUME") {
      const userJds = getUserCombinedJDs(conn.telegramUserId);
      if (userJds.length > 0) {
        // Analyze against the primary or first JD
        const primaryJd = userJds[0];
        const analysis = await analyzeResume(
          primaryJd.text,
          fileMeta.name,
          text,
          candidateId
        );
        record.analysisResult = analysis.result;
        saveUserAnalysisResults(conn.telegramUserId, [analysis.result]);
      }
    } else if (docType === "JD") {
      // If it's a new JD and user already has resumes, analyze them against this new JD
      const userResumes = getUserCombinedResumes(conn.telegramUserId);
      const newAnalysisResults: ResumeAnalysis[] = [];

      for (const res of userResumes) {
        try {
          const analysis = await analyzeResume(
            text,
            res.filename,
            res.text,
            res.candidateId
          );
          newAnalysisResults.push(analysis.result);
        } catch (resErr) {
          console.error(`Failed to analyze resume ${res.filename} against new JD:`, resErr);
        }
      }

      if (newAnalysisResults.length > 0) {
        saveUserAnalysisResults(conn.telegramUserId, newAnalysisResults);
      }
    }

    record.status = "completed";
    saveDriveFile(record);
    return record;
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    record.status = "failed";
    record.errorMessage = errMsg;
    saveDriveFile(record);
    throw error;
  }
}

export async function syncFolderConnection(
  conn: DriveFolderConnection,
  botInstance?: Bot<any>,
  isInitialConnect: boolean = false
): Promise<SyncResult> {
  const result: SyncResult = {
    folderId: conn.folderId,
    telegramUserId: conn.telegramUserId,
    foundFilesCount: 0,
    newFilesProcessedCount: 0,
    jdsCount: 0,
    resumesCount: 0,
    errors: [],
  };

  try {
    const files = await listFilesInFolder(conn.folderId);
    result.foundFilesCount = files.length;

    // Identify files that are not yet processed or have been modified
    const filesToProcess = files.filter((f) => !isDriveFileProcessed(f.id, f.modifiedTime));

    if (filesToProcess.length === 0) {
      // Nothing new to process
      conn.lastSyncedAt = new Date().toISOString();
      saveFolderConnection(conn);
      return result;
    }

    const jds = filesToProcess.filter((f) => classifyDocumentType(f.name, conn.uploadMode) === "JD");
    const resumes = filesToProcess.filter((f) => classifyDocumentType(f.name, conn.uploadMode) === "RESUME");

    // If this is a background discovery (not the initial folder command), send proactive alert
    if (!isInitialConnect && botInstance && conn.chatId) {
      try {
        const fileNamesList = filesToProcess.map((f) => `• <code>${f.name}</code>`).join("\n");
        await botInstance.api.sendMessage(
          conn.chatId,
          `🔔 <b>New files detected in your Google Drive folder!</b>\n\n` +
            `<b>JDs:</b> ${jds.length} | <b>Resumes:</b> ${resumes.length}\n\n` +
            `${fileNamesList}\n\n` +
            `⏳ Starting automatic analysis...`,
          { parse_mode: "HTML" }
        );
      } catch (notifyErr) {
        console.warn(`Failed to notify user ${conn.telegramUserId} of new Drive files:`, notifyErr);
      }
    }

    const newlyAnalyzedResults: ResumeAnalysis[] = [];

    // Process JDs first so any new resumes can be evaluated against them
    for (const jdFile of jds) {
      try {
        await processSingleDriveFile(jdFile, conn, botInstance);
        result.newFilesProcessedCount++;
        result.jdsCount++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push(`Failed to process JD ${jdFile.name}: ${msg}`);
      }
    }

    // Process Resumes
    for (const resFile of resumes) {
      try {
        const record = await processSingleDriveFile(resFile, conn, botInstance);
        result.newFilesProcessedCount++;
        result.resumesCount++;
        if (record.analysisResult) {
          newlyAnalyzedResults.push(record.analysisResult);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push(`Failed to process Resume ${resFile.name}: ${msg}`);
      }
    }

    conn.lastSyncedAt = new Date().toISOString();
    saveFolderConnection(conn);

    // Send completion summary if running in background
    if (!isInitialConnect && botInstance && conn.chatId && result.newFilesProcessedCount > 0) {
      try {
        let msg = `✅ <b>Analysis complete!</b>\n\n${result.newFilesProcessedCount} new document(s) have been added to your recruitment dataset.`;

        if (newlyAnalyzedResults.length > 0) {
          msg += `\n\n📊 <b>New Candidates Analyzed:</b>\n`;
          newlyAnalyzedResults.forEach((res, idx) => {
            msg += `${idx + 1}. <b>${res.displayName}</b> — Score: ${res.overallScore}/100 (${res.recommendation})\n`;
          });
          msg += `\n💡 <i>You can now ask questions about these candidates!</i>`;
        }

        await botInstance.api.sendMessage(conn.chatId, msg, { parse_mode: "HTML" });
      } catch (notifyErr) {
        console.warn(`Failed to send completion notification to user ${conn.telegramUserId}:`, notifyErr);
      }
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    result.errors.push(`Folder sync failed: ${msg}`);
  }

  return result;
}

export async function syncAllConnectedFolders(botInstance?: Bot<any>): Promise<SyncResult[]> {
  const connections = getAllFolderConnections();
  const results: SyncResult[] = [];

  for (const conn of connections) {
    try {
      const res = await syncFolderConnection(conn, botInstance, false);
      results.push(res);
    } catch (err) {
      console.error(`Error syncing folder connection ${conn.id}:`, err);
    }
  }

  return results;
}
