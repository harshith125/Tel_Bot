import {
  saveFolderConnection,
  getUserFolderConnections,
  deleteFolderConnection,
  saveDriveFile,
  isDriveFileProcessed,
  getUserDriveFiles,
  saveUserManualDocument,
  getUserCombinedJDs,
  getUserCombinedResumes,
  clearUserData,
} from "../lib/db";

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    process.exit(1);
  } else {
    console.log(`✅ PASSED: ${message}`);
  }
}

console.log("--- Testing DB Multi-User Isolation & Deduplication ---");

const userA = "11111";
const userB = "22222";

// Clear any existing test data
clearUserData(userA);
clearUserData(userB);

// 1. Connect Folder for User A
saveFolderConnection({
  id: `${userA}_folder123`,
  telegramUserId: userA,
  chatId: "11111",
  folderId: "folder123",
  connectedAt: new Date().toISOString(),
  uploadMode: "auto",
});

// Connect Folder for User B
saveFolderConnection({
  id: `${userB}_folder456`,
  telegramUserId: userB,
  chatId: "22222",
  folderId: "folder456",
  connectedAt: new Date().toISOString(),
  uploadMode: "resume",
});

const foldersA = getUserFolderConnections(userA);
const foldersB = getUserFolderConnections(userB);

assert(foldersA.length === 1 && foldersA[0].folderId === "folder123", "User A has folder123");
assert(foldersB.length === 1 && foldersB[0].folderId === "folder456", "User B has folder456");

// 2. Test File Processing & Deduplication
assert(isDriveFileProcessed("file_jd_1") === false, "Unprocessed file returns false");

saveDriveFile({
  driveFileId: "file_jd_1",
  folderId: "folder123",
  telegramUserId: userA,
  chatId: "11111",
  fileName: "JD_React.pdf",
  mimeType: "application/pdf",
  modifiedTime: "2026-09-22T10:00:00Z",
  processedAt: new Date().toISOString(),
  documentType: "JD",
  status: "completed",
  parsedText: "React developer JD content",
});

assert(isDriveFileProcessed("file_jd_1", "2026-09-22T10:00:00Z") === true, "Processed file with same modifiedTime returns true");
assert(isDriveFileProcessed("file_jd_1", "2026-09-22T12:00:00Z") === false, "Processed file with newer modifiedTime returns false for re-analysis");

// 3. User B must NOT see User A's files
const userAFiles = getUserDriveFiles(userA);
const userBFiles = getUserDriveFiles(userB);

assert(userAFiles.length === 1 && userAFiles[0].driveFileId === "file_jd_1", "User A has 1 Drive file");
assert(userBFiles.length === 0, "User B has 0 Drive files (isolation check)");

// 4. Combined Documents (Telegram upload + Drive files)
saveUserManualDocument(userA, { filename: "Manual_Resume.pdf", text: "Manual resume text", candidateId: "CV101" }, "RESUME");

const combinedJdsA = getUserCombinedJDs(userA);
const combinedResumesA = getUserCombinedResumes(userA);

assert(combinedJdsA.length === 1 && combinedJdsA[0].filename === "JD_React.pdf", "User A combined JDs includes Drive JD");
assert(combinedResumesA.length === 1 && combinedResumesA[0].candidateId === "CV101", "User A combined Resumes includes manual resume");

// 5. Cleanup
deleteFolderConnection(userA, "folder123");
assert(getUserFolderConnections(userA).length === 0, "Folder disconnect works");

clearUserData(userA);
clearUserData(userB);

console.log("\n🎉 ALL DB INTEGRATION TESTS PASSED!");
