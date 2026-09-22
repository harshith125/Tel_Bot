import { parseDriveUrl, classifyDocumentType } from "../lib/drive";

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    process.exit(1);
  } else {
    console.log(`✅ PASSED: ${message}`);
  }
}

console.log("--- Testing Google Drive URL Parser ---");

// Folder URLs
const folderUrl1 = "https://drive.google.com/drive/folders/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs";
const parsed1 = parseDriveUrl(folderUrl1);
assert(parsed1 !== null && parsed1.type === "folder" && parsed1.id === "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs", "Standard folder link");

const folderUrl2 = "https://drive.google.com/drive/u/0/folders/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs?usp=sharing";
const parsed2 = parseDriveUrl(folderUrl2);
assert(parsed2 !== null && parsed2.type === "folder" && parsed2.id === "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs", "Folder link with query params and /u/0/");

// File URLs
const fileUrl1 = "https://drive.google.com/file/d/1Z_xAbCdEfGhIjKlMnOpQrStUvWxYz123/view?usp=sharing";
const parsed3 = parseDriveUrl(fileUrl1);
assert(parsed3 !== null && parsed3.type === "file" && parsed3.id === "1Z_xAbCdEfGhIjKlMnOpQrStUvWxYz123", "Standard file link");

const fileUrl2 = "https://docs.google.com/file/d/1Z_xAbCdEfGhIjKlMnOpQrStUvWxYz123/edit";
const parsed4 = parseDriveUrl(fileUrl2);
assert(parsed4 !== null && parsed4.type === "file" && parsed4.id === "1Z_xAbCdEfGhIjKlMnOpQrStUvWxYz123", "Docs file link");

// Non-Drive URL
const nonDrive = "https://example.com/somefile.pdf";
assert(parseDriveUrl(nonDrive) === null, "Non-Drive URL returns null");

console.log("\n--- Testing Document Classification ---");
assert(classifyDocumentType("JD_Software_Engineer.pdf") === "JD", "JD_Software_Engineer.pdf -> JD");
assert(classifyDocumentType("Job_Description_React.docx") === "JD", "Job_Description_React.docx -> JD");
assert(classifyDocumentType("CV273.pdf") === "RESUME", "CV273.pdf -> RESUME");
assert(classifyDocumentType("Resume_John_Doe.pdf") === "RESUME", "Resume_John_Doe.pdf -> RESUME");
assert(classifyDocumentType("Candidate_390.docx") === "RESUME", "Candidate_390.docx -> RESUME");
assert(classifyDocumentType("CV273 - Anonymous.pdf") === "RESUME", "CV273 - Anonymous.pdf -> RESUME");

console.log("\n🎉 ALL DRIVE PARSER TESTS PASSED!");
