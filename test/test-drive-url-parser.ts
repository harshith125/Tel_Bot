import { parseDriveUrl, classifyDocumentType } from "../lib/drive";

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    process.exit(1);
  } else {
    console.log(`✅ PASSED: ${message}`);
  }
}

console.log("--- Testing Comprehensive Google Drive URL Parser ---");

const testCases = [
  {
    input: "https://drive.google.com/file/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs/view?usp=sharing",
    expectedType: "file",
    expectedId: "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs",
  },
  {
    input: "https://drive.google.com/file/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs",
    expectedType: "file",
    expectedId: "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs",
  },
  {
    input: "https://docs.google.com/document/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs/edit?usp=sharing",
    expectedType: "file",
    expectedId: "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs",
  },
  {
    input: "https://drive.google.com/drive/folders/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs",
    expectedType: "folder",
    expectedId: "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs",
  },
  {
    input: "https://drive.google.com/drive/u/0/folders/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs?usp=drive_link",
    expectedType: "folder",
    expectedId: "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs",
  },
  {
    input: "https://drive.google.com/drive/u/1/folders/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs",
    expectedType: "folder",
    expectedId: "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs",
  },
  {
    input: "Here is the candidate resume: https://drive.google.com/file/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs/view please evaluate",
    expectedType: "file",
    expectedId: "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs",
  },
  {
    input: "check this folder https://drive.google.com/drive/folders/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs for JDs",
    expectedType: "folder",
    expectedId: "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs",
  },
];

for (const tc of testCases) {
  const result = parseDriveUrl(tc.input);
  assert(
    result !== null && result.type === tc.expectedType && result.id === tc.expectedId,
    `Input: "${tc.input}" -> type: ${tc.expectedType}, id: ${tc.expectedId}`
  );
}

console.log("\n🎉 ALL COMPREHENSIVE URL TESTS PASSED!");
