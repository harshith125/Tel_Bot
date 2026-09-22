async function inspectPublicFolder() {
  // Try fetching public folder HTML directly
  const folderId = "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs";
  const url = `https://drive.google.com/drive/folders/${folderId}`;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    console.log("Status:", res.status);
    const html = await res.text();
    console.log("HTML length:", html.length);

    // Look for file metadata patterns in the HTML
    // Google Drive embeds item data in JSON or array structures
    const idRegex = /([a-zA-Z0-9_-]{25,})/g;
    const matches = Array.from(html.matchAll(idRegex)).map(m => m[1]);
    console.log(`Found ${matches.length} ID-like strings in HTML`);

    // Let's check for title / filename patterns (.pdf, .docx)
    const docRegex = /([a-zA-Z0-9_ -]+\.(?:pdf|docx|doc))/gi;
    const docMatches = Array.from(html.matchAll(docRegex)).map(m => m[1]);
    console.log("Found doc names:", Array.from(new Set(docMatches)));
  } catch (e) {
    console.error("Error:", e);
  }
}

inspectPublicFolder();
