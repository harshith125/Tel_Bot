import JSZip from "jszip";
import mammoth from "mammoth";
import pdf from "pdf-parse-new";

const SUPPORTED_EXTENSIONS = [".pdf", ".docx"];
const MAX_FILE_SIZE = 15 * 1024 * 1024;
const MAX_TEXT_LENGTH = 40_000;
const MAX_ZIP_FILES = 30;

export interface ParsedDocument {
  filename: string;
  text: string;
}

function getExtension(filename: string): string {
  const index = filename.lastIndexOf(".");
  return index === -1 ? "" : filename.slice(index).toLowerCase();
}

export function isSupportedDocument(filename: string): boolean {
  return SUPPORTED_EXTENSIONS.includes(getExtension(filename));
}

function cleanExtractedText(text: string): string {
  return text
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim()
    .slice(0, MAX_TEXT_LENGTH);
}

async function parsePdf(buffer: Buffer): Promise<string> {
  const result = await pdf(buffer);
  return cleanExtractedText(result.text ?? "");
}

async function parseDocx(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({
    buffer,
  });

  return cleanExtractedText(result.value ?? "");
}

export async function extractDocumentText(
  filename: string,
  buffer: Buffer,
): Promise<string> {
  if (buffer.length > MAX_FILE_SIZE) {
    throw new Error(`${filename} is larger than 15 MB.`);
  }

  const extension = getExtension(filename);

  if (extension === ".pdf") {
    return parsePdf(buffer);
  }

  if (extension === ".docx") {
    return parseDocx(buffer);
  }

  throw new Error(
    `${filename} is unsupported. Only PDF and DOCX are accepted.`,
  );
}

export async function parseUploadedFile(
  filename: string,
  buffer: Buffer,
): Promise<ParsedDocument> {
  const text = await extractDocumentText(filename, buffer);

  if (!text) {
    throw new Error(
      `No readable text was found in ${filename}. ` +
        "The document may be scanned or image-based.",
    );
  }

  return {
    filename,
    text,
  };
}

export async function extractResumesFromZip(
  buffer: Buffer,
): Promise<ParsedDocument[]> {
  if (buffer.length > 30 * 1024 * 1024) {
    throw new Error("The ZIP file is larger than 30 MB.");
  }

  const zip = await JSZip.loadAsync(buffer);

  const entries = Object.values(zip.files).filter(
    (entry) =>
      !entry.dir &&
      !entry.name.startsWith("__MACOSX/") &&
      isSupportedDocument(entry.name),
  );

  if (entries.length === 0) {
    throw new Error(
      "The ZIP folder does not contain any PDF or DOCX resumes.",
    );
  }

  if (entries.length > MAX_ZIP_FILES) {
    throw new Error(
      `The ZIP contains more than ${MAX_ZIP_FILES} supported files.`,
    );
  }

  const parsedPromises = entries.map(async (entry) => {
    try {
      const entryBuffer = await entry.async("nodebuffer");
      const filename = entry.name.split("/").pop() ?? entry.name;
      const text = await extractDocumentText(filename, entryBuffer);

      if (text) {
        return { filename, text };
      }
    } catch (error) {
      console.error(`Unable to parse ZIP entry ${entry.name}:`, error);
    }
    return null;
  });

  const resolvedDocuments = await Promise.all(parsedPromises);
  const documents = resolvedDocuments.filter((doc): doc is ParsedDocument => doc !== null);

  if (documents.length === 0) {
    throw new Error(
      "No readable resumes were found inside the ZIP folder.",
    );
  }

  return documents;
}
