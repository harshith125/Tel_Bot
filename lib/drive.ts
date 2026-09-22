import { google, drive_v3 } from "googleapis";

export interface ParsedDriveUrl {
  type: "file" | "folder";
  id: string;
}

export interface DriveItemMetadata {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  size?: string;
}

let _driveClient: drive_v3.Drive | null = null;

export function parseDriveUrl(text: string): ParsedDriveUrl | null {
  const trimmed = text.trim();

  // Match Google Drive folder URLs
  // Examples:
  // https://drive.google.com/drive/folders/1aBcDeFgHiJkLmNoPqRsTuVwXyZ
  // https://drive.google.com/drive/u/0/folders/1aBcDeFgHiJkLmNoPqRsTuVwXyZ
  // https://drive.google.com/open?id=1aBcDeFgHiJkLmNoPqRsTuVwXyZ
  const folderMatch = trimmed.match(
    /(?:drive\.google\.com\/(?:drive\/(?:u\/\d+\/)?folders\/|open\?id=))([a-zA-Z0-9_-]{15,})/
  );

  if (folderMatch && trimmed.includes("folder")) {
    return {
      type: "folder",
      id: folderMatch[1],
    };
  }

  // Match Google Drive file URLs
  // Examples:
  // https://drive.google.com/file/d/1aBcDeFgHiJkLmNoPqRsTuVwXyZ/view
  // https://drive.google.com/file/d/1aBcDeFgHiJkLmNoPqRsTuVwXyZ
  // https://docs.google.com/file/d/1aBcDeFgHiJkLmNoPqRsTuVwXyZ
  const fileMatch = trimmed.match(
    /(?:drive\.google\.com\/(?:file\/d\/|uc\?id=)|docs\.google\.com\/file\/d\/)([a-zA-Z0-9_-]{15,})/
  );

  if (fileMatch) {
    return {
      type: "file",
      id: fileMatch[1],
    };
  }

  // Generic fallback if folder URL without the word "folder"
  if (folderMatch) {
    return {
      type: "folder",
      id: folderMatch[1],
    };
  }

  return null;
}

function getGoogleAuth() {
  const serviceAccountKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  let privateKey = process.env.GOOGLE_PRIVATE_KEY;

  if (serviceAccountKey) {
    try {
      let keyData: any;
      if (serviceAccountKey.startsWith("{")) {
        keyData = JSON.parse(serviceAccountKey);
      } else {
        // Assume base64 encoded
        const decoded = Buffer.from(serviceAccountKey, "base64").toString("utf-8");
        keyData = JSON.parse(decoded);
      }

      return new google.auth.JWT({
        email: keyData.client_email,
        key: keyData.private_key,
        scopes: ["https://www.googleapis.com/auth/drive.readonly"],
      });
    } catch (err) {
      console.error("Failed to parse GOOGLE_SERVICE_ACCOUNT_KEY:", err);
    }
  }

  if (clientEmail && privateKey) {
    // Replace escaped newlines if passed in .env
    privateKey = privateKey.replace(/\\n/g, "\n");
    return new google.auth.JWT({
      email: clientEmail,
      key: privateKey,
      scopes: ["https://www.googleapis.com/auth/drive.readonly"],
    });
  }

  const apiKey = process.env.GOOGLE_DRIVE_API_KEY;
  if (apiKey) {
    return apiKey;
  }

  return null;
}

export function getDriveClient(): drive_v3.Drive {
  if (_driveClient) return _driveClient;

  const auth = getGoogleAuth();
  if (!auth) {
    throw new Error(
      "Google Drive authentication missing. Please set GOOGLE_SERVICE_ACCOUNT_KEY (or GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY) in environment variables."
    );
  }

  if (typeof auth === "string") {
    _driveClient = google.drive({ version: "v3", auth: auth as any });
  } else {
    _driveClient = google.drive({ version: "v3", auth });
  }

  return _driveClient;
}

export async function getDriveFileMetadata(fileId: string): Promise<DriveItemMetadata> {
  const drive = getDriveClient();
  const res = await drive.files.get({
    fileId,
    fields: "id, name, mimeType, modifiedTime, size, trashed",
    supportsAllDrives: true,
  });

  const file = res.data;
  if (!file || file.trashed) {
    throw new Error(`Google Drive file ${fileId} was not found or is in trash.`);
  }

  return {
    id: file.id || fileId,
    name: file.name || "Untitled",
    mimeType: file.mimeType || "application/octet-stream",
    modifiedTime: file.modifiedTime || new Date().toISOString(),
    size: file.size || undefined,
  };
}

export async function downloadDriveFile(fileId: string): Promise<Buffer> {
  const drive = getDriveClient();
  const res = await drive.files.get(
    {
      fileId,
      alt: "media",
      supportsAllDrives: true,
    },
    { responseType: "arraybuffer" }
  );

  return Buffer.from(res.data as ArrayBuffer);
}

export async function listFilesInFolder(folderId: string): Promise<DriveItemMetadata[]> {
  const drive = getDriveClient();
  const files: DriveItemMetadata[] = [];
  let pageToken: string | undefined = undefined;

  do {
    const res: any = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false and (mimeType = 'application/pdf' or mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' or name contains '.pdf' or name contains '.docx')`,
      fields: "nextPageToken, files(id, name, mimeType, modifiedTime, size)",
      pageSize: 100,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      pageToken,
    });

    if (res.data.files) {
      for (const f of res.data.files) {
        if (f.id && f.name) {
          files.push({
            id: f.id,
            name: f.name,
            mimeType: f.mimeType || "application/octet-stream",
            modifiedTime: f.modifiedTime || new Date().toISOString(),
            size: f.size || undefined,
          });
        }
      }
    }

    pageToken = res.data.nextPageToken || undefined;
  } while (pageToken);

  return files;
}

export function classifyDocumentType(
  filename: string,
  modePreference?: "jd" | "resume" | "auto"
): "JD" | "RESUME" {
  if (modePreference === "jd") return "JD";
  if (modePreference === "resume") return "RESUME";

  const lower = filename.toLowerCase();

  // Explicit JD indicators
  if (
    lower.startsWith("jd") ||
    lower.includes("job description") ||
    lower.includes("job_description") ||
    lower.includes("job-description") ||
    lower.includes("requirements") ||
    lower.includes("role_description") ||
    lower.includes("position_description")
  ) {
    return "JD";
  }

  // Explicit Resume indicators
  if (
    lower.startsWith("cv") ||
    lower.includes("resume") ||
    lower.includes("curriculum") ||
    lower.includes("candidate") ||
    lower.includes("applicant")
  ) {
    return "RESUME";
  }

  // Default to RESUME if ambiguous in auto mode
  return "RESUME";
}
