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
  if (!text || typeof text !== "string") return null;

  // 1. Check for folder links anywhere in the string
  // e.g. drive.google.com/drive/folders/ID or drive.google.com/drive/u/0/folders/ID or drive.google.com/folderview?id=ID
  const folderMatch = text.match(
    /(?:drive\.google\.com\/(?:drive\/(?:u\/\d+\/)?folders\/|folderview\?id=))([a-zA-Z0-9_-]{10,})/i
  );

  if (folderMatch) {
    return {
      type: "folder",
      id: folderMatch[1],
    };
  }

  // 2. Check for file links anywhere in the string
  // e.g. drive.google.com/file/d/ID/view, docs.google.com/document/d/ID, drive.google.com/open?id=ID, drive.google.com/uc?id=ID
  const fileMatch = text.match(
    /(?:drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?id=)|docs\.google\.com\/(?:document|spreadsheets|presentation|file)\/d\/)([a-zA-Z0-9_-]{10,})/i
  );

  if (fileMatch) {
    return {
      type: "file",
      id: fileMatch[1],
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

export function hasGoogleCredentials(): boolean {
  return Boolean(
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY ||
      (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) ||
      process.env.GOOGLE_DRIVE_API_KEY
  );
}

export function getDriveClient(): drive_v3.Drive | null {
  if (_driveClient) return _driveClient;

  const auth = getGoogleAuth();
  if (!auth) {
    return null;
  }

  if (typeof auth === "string") {
    _driveClient = google.drive({ version: "v3", auth: auth as any });
  } else {
    _driveClient = google.drive({ version: "v3", auth });
  }

  return _driveClient;
}

/**
 * Public direct downloader fallback when service account is not yet configured.
 * Works for any Google Drive file or Google Doc shared with "Anyone with the link".
 */
export async function downloadPublicDriveFile(
  fileId: string
): Promise<{ buffer: Buffer; filename?: string }> {
  const downloadUrls = [
    `https://drive.google.com/uc?export=download&id=${fileId}&confirm=t`,
    `https://docs.google.com/document/d/${fileId}/export?format=pdf`,
    `https://docs.google.com/document/d/${fileId}/export?format=docx`,
  ];

  for (const url of downloadUrls) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
        redirect: "follow",
      });

      if (res.ok) {
        const contentType = res.headers.get("content-type") || "";

        // If Google presents an HTML confirmation page for large files, parse confirm token
        if (contentType.includes("text/html")) {
          const html = await res.text();
          const confirmMatch = html.match(/confirm=([0-9A-Za-z_-]+)/);
          if (confirmMatch) {
            const confirmRes = await fetch(
              `https://drive.google.com/uc?export=download&id=${fileId}&confirm=${confirmMatch[1]}`,
              { redirect: "follow" }
            );
            if (confirmRes.ok) {
              const arrayBuf = await confirmRes.arrayBuffer();
              const buf = Buffer.from(arrayBuf);
              if (buf.length > 100) {
                return { buffer: buf };
              }
            }
          }
          continue;
        }

        const arrayBuf = await res.arrayBuffer();
        const buf = Buffer.from(arrayBuf);
        if (buf.length > 50) {
          const disp = res.headers.get("content-disposition");
          let filename: string | undefined;
          if (disp) {
            const match = disp.match(/filename\*?=['"]?(?:UTF-8'')?([^'";\n]+)['"]?/i);
            if (match) filename = decodeURIComponent(match[1]);
          }
          return { buffer: buf, filename };
        }
      }
    } catch {
      // try next URL
    }
  }

  throw new Error(
    "Could not download file. Please ensure the Google Drive file is shared with 'Anyone with the link' (Viewer), or configure GOOGLE_SERVICE_ACCOUNT_KEY in environment variables."
  );
}

export async function getDriveFileMetadata(fileId: string): Promise<DriveItemMetadata> {
  const drive = getDriveClient();

  if (drive) {
    try {
      const res = await drive.files.get({
        fileId,
        fields: "id, name, mimeType, modifiedTime, size, trashed",
        supportsAllDrives: true,
      });

      const file = res.data;
      if (file && !file.trashed) {
        return {
          id: file.id || fileId,
          name: file.name || "Untitled_Document.pdf",
          mimeType: file.mimeType || "application/pdf",
          modifiedTime: file.modifiedTime || new Date().toISOString(),
          size: file.size || undefined,
        };
      }
    } catch (apiErr) {
      console.warn(`Drive API files.get failed for ${fileId}, trying public fallback:`, apiErr);
    }
  }

  // Fallback: Fetch public page title
  try {
    const pageRes = await fetch(`https://drive.google.com/file/d/${fileId}/view`, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });

    if (pageRes.ok) {
      const html = await pageRes.text();
      const titleMatch =
        html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i) ||
        html.match(/<title>([^<]+)<\/title>/i);

      if (titleMatch && titleMatch[1]) {
        let name = titleMatch[1].replace(/ - Google (?:Drive|Docs)$/i, "").trim();
        if (name && name.length > 0) {
          return {
            id: fileId,
            name,
            mimeType: name.endsWith(".docx")
              ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              : "application/pdf",
            modifiedTime: new Date().toISOString(),
          };
        }
      }
    }
  } catch {}

  return {
    id: fileId,
    name: `Drive_Document_${fileId.slice(0, 8)}.pdf`,
    mimeType: "application/pdf",
    modifiedTime: new Date().toISOString(),
  };
}

export async function downloadDriveFile(fileId: string): Promise<Buffer> {
  const drive = getDriveClient();

  if (drive) {
    try {
      const res = await drive.files.get(
        {
          fileId,
          alt: "media",
          supportsAllDrives: true,
        },
        { responseType: "arraybuffer" }
      );
      return Buffer.from(res.data as ArrayBuffer);
    } catch (apiErr) {
      console.warn(`Drive API download failed for ${fileId}, trying public download fallback:`, apiErr);
    }
  }

  // Public direct download fallback
  const downloaded = await downloadPublicDriveFile(fileId);
  return downloaded.buffer;
}

export async function listFilesInFolder(folderId: string): Promise<DriveItemMetadata[]> {
  const drive = getDriveClient();

  if (!drive) {
    throw new Error(
      "To connect and monitor Google Drive folders, a Google Cloud Service Account is required. Please set GOOGLE_SERVICE_ACCOUNT_KEY in your environment variables and share the folder with the Service Account email."
    );
  }

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

  return "RESUME";
}
