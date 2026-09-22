import fs from "fs";
import path from "path";
import { MongoClient, Db } from "mongodb";
import type { ResumeAnalysis } from "@/types/analysis";
import type { ParsedDocument } from "./document-parser";

export interface DriveFolderConnection {
  id: string; // e.g. `${telegramUserId}_${folderId}`
  telegramUserId: string;
  chatId: string;
  folderId: string;
  folderName?: string;
  connectedAt: string;
  lastSyncedAt?: string;
  uploadMode: "jd" | "resume" | "auto";
}

export interface DriveFileRecord {
  driveFileId: string;
  folderId?: string;
  telegramUserId: string;
  chatId: string;
  fileName: string;
  mimeType: string;
  modifiedTime: string;
  processedAt: string;
  documentType: "JD" | "RESUME";
  candidateId?: string;
  status: "pending" | "processing" | "completed" | "failed";
  errorMessage?: string;
  parsedText?: string;
  analysisResult?: ResumeAnalysis;
}

export interface StoredManualDocument {
  id: string;
  telegramUserId: string;
  documentType: "JD" | "RESUME";
  filename: string;
  text: string;
  candidateId?: string;
  createdAt: string;
}

interface DatabaseSchema {
  folderConnections: Record<string, DriveFolderConnection>;
  driveFiles: Record<string, DriveFileRecord>;
  manualDocuments: Record<string, StoredManualDocument>;
  userAnalysisResults: Record<string, ResumeAnalysis[]>; // key: telegramUserId
}

const DB_PATH =
  process.env.DB_FILE_PATH ||
  (process.env.NODE_ENV === "production" && process.env.VERCEL
    ? "/tmp/hirematrix_db.json"
    : path.resolve(process.cwd(), "data", "hirematrix_db.json"));

let _memoryDb: DatabaseSchema | null = null;
let _mongoClient: MongoClient | null = null;
let _mongoDb: Db | null = null;
let _mongoInitPromise: Promise<void> | null = null;

async function getMongoDb(): Promise<Db | null> {
  const uri = process.env.MONGODB_URI;
  if (!uri) return null;

  if (_mongoDb) return _mongoDb;

  if (!_mongoInitPromise) {
    _mongoInitPromise = (async () => {
      try {
        _mongoClient = new MongoClient(uri, {
          maxPoolSize: 10,
          serverSelectionTimeoutMS: 5000,
        });
        await _mongoClient.connect();
        _mongoDb = _mongoClient.db();
        console.log("🍃 MongoDB connected successfully to database:", _mongoDb.databaseName);

        // Preload MongoDB data into memory cache
        await hydrateFromMongo(_mongoDb);
      } catch (err) {
        console.warn("⚠️ MongoDB connection failed, falling back to local storage:", err);
        _mongoDb = null;
      }
    })();
  }

  await _mongoInitPromise;
  return _mongoDb;
}

async function hydrateFromMongo(db: Db): Promise<void> {
  const mem = ensureDbFile();
  try {
    const folders = await db.collection<DriveFolderConnection>("folder_connections").find({}).toArray();
    for (const f of folders) {
      mem.folderConnections[f.id] = f;
    }

    const files = await db.collection<DriveFileRecord>("drive_files").find({}).toArray();
    for (const f of files) {
      mem.driveFiles[f.driveFileId] = f;
    }

    const docs = await db.collection<StoredManualDocument>("manual_documents").find({}).toArray();
    for (const d of docs) {
      mem.manualDocuments[d.id] = d;
    }

    const analyses = await db.collection<{ telegramUserId: string; results: ResumeAnalysis[] }>("user_analysis").find({}).toArray();
    for (const a of analyses) {
      mem.userAnalysisResults[a.telegramUserId] = a.results;
    }
  } catch (err) {
    console.error("Failed hydrating memory from MongoDB:", err);
  }
}

function ensureDbFile(): DatabaseSchema {
  if (_memoryDb) return _memoryDb;

  try {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (fs.existsSync(DB_PATH)) {
      const data = fs.readFileSync(DB_PATH, "utf-8");
      _memoryDb = JSON.parse(data) as DatabaseSchema;
    } else {
      _memoryDb = {
        folderConnections: {},
        driveFiles: {},
        manualDocuments: {},
        userAnalysisResults: {},
      };
      fs.writeFileSync(DB_PATH, JSON.stringify(_memoryDb, null, 2), "utf-8");
    }
  } catch {
    _memoryDb = {
      folderConnections: {},
      driveFiles: {},
      manualDocuments: {},
      userAnalysisResults: {},
    };
  }

  if (!_memoryDb.folderConnections) _memoryDb.folderConnections = {};
  if (!_memoryDb.driveFiles) _memoryDb.driveFiles = {};
  if (!_memoryDb.manualDocuments) _memoryDb.manualDocuments = {};
  if (!_memoryDb.userAnalysisResults) _memoryDb.userAnalysisResults = {};

  // Kick off async Mongo connection if URI exists
  if (process.env.MONGODB_URI) {
    getMongoDb().catch(() => {});
  }

  return _memoryDb;
}

function flushDb(): void {
  if (!_memoryDb) return;
  try {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(DB_PATH, JSON.stringify(_memoryDb, null, 2), "utf-8");
  } catch (error) {
    console.error("Failed to flush local DB:", error);
  }
}

// ---------------------------------------------------------------------------
// Folder Connections
// ---------------------------------------------------------------------------

export function saveFolderConnection(conn: DriveFolderConnection): void {
  const db = ensureDbFile();
  db.folderConnections[conn.id] = { ...conn };
  flushDb();

  // Async push to MongoDB
  getMongoDb()
    .then((mongo) => {
      if (mongo) {
        mongo
          .collection("folder_connections")
          .updateOne({ id: conn.id }, { $set: conn }, { upsert: true })
          .catch((e) => console.error("Mongo saveFolderConnection error:", e));
      }
    })
    .catch(() => {});
}

export function getAllFolderConnections(): DriveFolderConnection[] {
  const db = ensureDbFile();
  return Object.values(db.folderConnections);
}

export function getUserFolderConnections(telegramUserId: string): DriveFolderConnection[] {
  const db = ensureDbFile();
  return Object.values(db.folderConnections).filter(
    (c) => String(c.telegramUserId) === String(telegramUserId)
  );
}

export function deleteFolderConnection(telegramUserId: string, folderId: string): boolean {
  const db = ensureDbFile();
  const id = `${telegramUserId}_${folderId}`;
  if (db.folderConnections[id]) {
    delete db.folderConnections[id];
    flushDb();

    getMongoDb()
      .then((mongo) => {
        if (mongo) {
          mongo.collection("folder_connections").deleteOne({ id }).catch(() => {});
        }
      })
      .catch(() => {});

    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Drive Files
// ---------------------------------------------------------------------------

export function getDriveFile(driveFileId: string): DriveFileRecord | null {
  const db = ensureDbFile();
  return db.driveFiles[driveFileId] || null;
}

export function isDriveFileProcessed(driveFileId: string, modifiedTime?: string): boolean {
  const file = getDriveFile(driveFileId);
  if (!file || file.status !== "completed") return false;
  if (modifiedTime && file.modifiedTime !== modifiedTime) {
    return false;
  }
  return true;
}

export function saveDriveFile(record: DriveFileRecord): void {
  const db = ensureDbFile();
  db.driveFiles[record.driveFileId] = { ...record };
  flushDb();

  getMongoDb()
    .then((mongo) => {
      if (mongo) {
        mongo
          .collection("drive_files")
          .updateOne({ driveFileId: record.driveFileId }, { $set: record }, { upsert: true })
          .catch((e) => console.error("Mongo saveDriveFile error:", e));
      }
    })
    .catch(() => {});
}

export function getUserDriveFiles(
  telegramUserId: string,
  documentType?: "JD" | "RESUME"
): DriveFileRecord[] {
  const db = ensureDbFile();
  return Object.values(db.driveFiles).filter((f) => {
    const userMatch = String(f.telegramUserId) === String(telegramUserId);
    if (!userMatch) return false;
    if (documentType) return f.documentType === documentType;
    return true;
  });
}

// ---------------------------------------------------------------------------
// Manual Documents (Telegram uploads)
// ---------------------------------------------------------------------------

export function saveUserManualDocument(
  telegramUserId: string,
  doc: ParsedDocument,
  type: "JD" | "RESUME"
): void {
  const db = ensureDbFile();
  const id = `${telegramUserId}_${type}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const record: StoredManualDocument = {
    id,
    telegramUserId: String(telegramUserId),
    documentType: type,
    filename: doc.filename,
    text: doc.text,
    candidateId: doc.candidateId,
    createdAt: new Date().toISOString(),
  };

  db.manualDocuments[id] = record;
  flushDb();

  getMongoDb()
    .then((mongo) => {
      if (mongo) {
        mongo
          .collection("manual_documents")
          .updateOne({ id: record.id }, { $set: record }, { upsert: true })
          .catch((e) => console.error("Mongo saveUserManualDocument error:", e));
      }
    })
    .catch(() => {});
}

export function getUserManualDocuments(
  telegramUserId: string,
  type?: "JD" | "RESUME"
): ParsedDocument[] {
  const db = ensureDbFile();
  return Object.values(db.manualDocuments)
    .filter((d) => {
      const userMatch = String(d.telegramUserId) === String(telegramUserId);
      if (!userMatch) return false;
      if (type) return d.documentType === type;
      return true;
    })
    .map((d) => ({
      filename: d.filename,
      text: d.text,
      candidateId: d.candidateId,
    }));
}

// ---------------------------------------------------------------------------
// User Analysis Context (Combined Drive + Telegram Uploads)
// ---------------------------------------------------------------------------

export function saveUserAnalysisResults(
  telegramUserId: string,
  results: ResumeAnalysis[]
): void {
  const db = ensureDbFile();
  const userId = String(telegramUserId);
  const existing = db.userAnalysisResults[userId] || [];

  const mergedMap = new Map<string, ResumeAnalysis>();
  for (const r of existing) {
    mergedMap.set(`${r.candidateId}_${r.resumeFilename}`, r);
  }
  for (const r of results) {
    mergedMap.set(`${r.candidateId}_${r.resumeFilename}`, r);
  }

  const finalResults = Array.from(mergedMap.values());
  db.userAnalysisResults[userId] = finalResults;
  flushDb();

  getMongoDb()
    .then((mongo) => {
      if (mongo) {
        mongo
          .collection("user_analysis")
          .updateOne(
            { telegramUserId: userId },
            { $set: { telegramUserId: userId, results: finalResults, updatedAt: new Date().toISOString() } },
            { upsert: true }
          )
          .catch((e) => console.error("Mongo saveUserAnalysisResults error:", e));
      }
    })
    .catch(() => {});
}

export function getUserAnalysisResults(telegramUserId: string): ResumeAnalysis[] {
  const db = ensureDbFile();
  return db.userAnalysisResults[String(telegramUserId)] || [];
}

export function getUserCombinedJDs(telegramUserId: string): ParsedDocument[] {
  const manualJds = getUserManualDocuments(telegramUserId, "JD");
  const driveJds = getUserDriveFiles(telegramUserId, "JD")
    .filter((f) => f.status === "completed" && f.parsedText)
    .map((f) => ({
      filename: f.fileName,
      text: f.parsedText!,
    }));

  return [...manualJds, ...driveJds];
}

export function getUserCombinedResumes(telegramUserId: string): ParsedDocument[] {
  const manualResumes = getUserManualDocuments(telegramUserId, "RESUME");
  const driveResumes = getUserDriveFiles(telegramUserId, "RESUME")
    .filter((f) => f.status === "completed" && f.parsedText)
    .map((f) => ({
      filename: f.fileName,
      text: f.parsedText!,
      candidateId: f.candidateId,
    }));

  return [...manualResumes, ...driveResumes];
}

export function clearUserData(telegramUserId: string): void {
  const db = ensureDbFile();
  const userId = String(telegramUserId);

  for (const [id, doc] of Object.entries(db.manualDocuments)) {
    if (doc.telegramUserId === userId) {
      delete db.manualDocuments[id];
    }
  }

  for (const [id, file] of Object.entries(db.driveFiles)) {
    if (file.telegramUserId === userId) {
      delete db.driveFiles[id];
    }
  }

  for (const [id, conn] of Object.entries(db.folderConnections)) {
    if (conn.telegramUserId === userId) {
      delete db.folderConnections[id];
    }
  }

  delete db.userAnalysisResults[userId];
  flushDb();

  getMongoDb()
    .then((mongo) => {
      if (mongo) {
        mongo.collection("folder_connections").deleteMany({ telegramUserId: userId }).catch(() => {});
        mongo.collection("drive_files").deleteMany({ telegramUserId: userId }).catch(() => {});
        mongo.collection("manual_documents").deleteMany({ telegramUserId: userId }).catch(() => {});
        mongo.collection("user_analysis").deleteMany({ telegramUserId: userId }).catch(() => {});
      }
    })
    .catch(() => {});
}
