import {
  extractCandidateId,
  isReliableCandidateName,
  formatCandidateDisplayName,
  ensureUniqueCandidateIds,
} from "../lib/candidate-utils";

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    process.exit(1);
  } else {
    console.log(`✅ PASSED: ${message}`);
  }
}

console.log("--- Testing Candidate ID Extraction ---");
assert(extractCandidateId("CV273.pdf") === "CV273", "CV273.pdf -> CV273");
assert(extractCandidateId("CV390.pdf") === "CV390", "CV390.pdf -> CV390");
assert(extractCandidateId("CV273 - Anonymous.pdf") === "CV273", "CV273 - Anonymous.pdf -> CV273");
assert(extractCandidateId("CV273-Anonymous.pdf") === "CV273", "CV273-Anonymous.pdf -> CV273");
assert(extractCandidateId("CV_273.pdf") === "CV273", "CV_273.pdf -> CV273");
assert(extractCandidateId("CV 273 (Anonymous).pdf") === "CV273", "CV 273 (Anonymous).pdf -> CV273");
assert(extractCandidateId("Candidate-42.docx") === "Candidate42", "Candidate-42.docx -> Candidate42");
assert(extractCandidateId("Anonymous.pdf", 0) === "CV1", "Anonymous.pdf -> CV1");
assert(extractCandidateId("Anonymous.pdf", 1) === "CV2", "Anonymous.pdf -> CV2");

console.log("\n--- Testing Name Reliability Check ---");
assert(isReliableCandidateName("Anonymous") === false, "'Anonymous' is not reliable");
assert(isReliableCandidateName("anonymous") === false, "'anonymous' is not reliable");
assert(isReliableCandidateName("N/A") === false, "'N/A' is not reliable");
assert(isReliableCandidateName("Unknown") === false, "'Unknown' is not reliable");
assert(isReliableCandidateName("None") === false, "'None' is not reliable");
assert(isReliableCandidateName("Not provided") === false, "'Not provided' is not reliable");
assert(isReliableCandidateName("Candidate") === false, "'Candidate' is not reliable");
assert(isReliableCandidateName("CV273") === false, "'CV273' is not reliable as a person's name");
assert(isReliableCandidateName("") === false, "Empty string is not reliable");
assert(isReliableCandidateName(null) === false, "null is not reliable");
assert(isReliableCandidateName("John Doe") === true, "'John Doe' is reliable");
assert(isReliableCandidateName("Jane Smith") === true, "'Jane Smith' is reliable");

console.log("\n--- Testing Display Name Formatting ---");
assert(formatCandidateDisplayName("CV273", "") === "CV273", "CV273 with empty name -> CV273");
assert(formatCandidateDisplayName("CV273", "Anonymous") === "CV273", "CV273 with 'Anonymous' -> CV273");
assert(formatCandidateDisplayName("CV273", "Unknown") === "CV273", "CV273 with 'Unknown' -> CV273");
assert(formatCandidateDisplayName("CV273", "John Doe") === "John Doe (CV273)", "CV273 with 'John Doe' -> John Doe (CV273)");
assert(formatCandidateDisplayName("CV273", "John Doe (CV273)") === "John Doe (CV273)", "CV273 with 'John Doe (CV273)' -> John Doe (CV273)");
assert(formatCandidateDisplayName("CV390", null) === "CV390", "CV390 with null -> CV390");

console.log("\n--- Testing Unique Candidate IDs ---");
const items = [
  { filename: "CV273.pdf" },
  { filename: "CV273.pdf" },
  { filename: "CV390.pdf" },
  { filename: "Anonymous.pdf" },
  { filename: "Anonymous.pdf" },
];
const unique = ensureUniqueCandidateIds(items);
assert(unique[0].candidateId === "CV273", "First CV273 is CV273");
assert(unique[1].candidateId === "CV273-2", "Duplicate CV273 is CV273-2");
assert(unique[2].candidateId === "CV390", "CV390 is CV390");
assert(unique[3].candidateId === "CV4", "First Anonymous gets CV4");
assert(unique[4].candidateId === "CV5", "Second Anonymous gets CV5");

console.log("\n🎉 ALL TESTS PASSED SUCCESSFULLY!");
