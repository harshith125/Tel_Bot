/**
 * Utility functions for Candidate ID extraction, name validation, and display formatting.
 */

export function extractCandidateId(filename: string, fallbackIndex?: number): string {
  // Strip file extension
  const withoutExt = filename.replace(/\.[^/.]+$/, "").trim();

  // 1. Explicit CV pattern: e.g. "CV273", "CV 273", "CV-273", "CV_273"
  const cvMatch = withoutExt.match(/\bCV\s*[-_]?\s*(\d+)\b/i);
  if (cvMatch) {
    return `CV${cvMatch[1]}`;
  }

  // 2. Candidate pattern: e.g. "Candidate 12", "Candidate-12", "Candidate_12", "Candidate12"
  const candMatch = withoutExt.match(/\bCandidate\s*[-_]?\s*(\d+)\b/i);
  if (candMatch) {
    return `Candidate${candMatch[1]}`;
  }

  // 3. ID pattern: e.g. "ID 123", "ID-123", "ID_123"
  const idMatch = withoutExt.match(/\bID\s*[-_]?\s*(\d+)\b/i);
  if (idMatch) {
    return `ID${idMatch[1]}`;
  }

  // 4. Strip common anonymous phrases like "- Anonymous", "(Anonymous)", "[Anonymous]", "Anonymous -"
  const cleaned = withoutExt
    .replace(/^anonymous\s*[-_:]*\s*/i, "")
    .replace(/\s*[-_:]*\s*anonymous$/i, "")
    .replace(/\s*\(\s*anonymous\s*\)/gi, "")
    .replace(/\s*\[\s*anonymous\s*\]/gi, "")
    .trim();

  if (cleaned.length > 0 && !/^anonymous$/i.test(cleaned)) {
    return cleaned;
  }

  if (fallbackIndex !== undefined && fallbackIndex >= 0) {
    return `CV${fallbackIndex + 1}`;
  }

  return "Candidate";
}

export function isReliableCandidateName(name?: string | null): boolean {
  if (!name) return false;
  const trimmed = name.trim();
  if (!trimmed) return false;

  const lower = trimmed.toLowerCase();
  const unreliablePatterns = [
    /^anonymous$/i,
    /^unknown$/i,
    /^n\/?a$/i,
    /^none$/i,
    /^not\s+provided$/i,
    /^not\s+mentioned$/i,
    /^not\s+specified$/i,
    /^not\s+available$/i,
    /^candidate$/i,
    /^candidate\s*#?\d+$/i,
    /^cv\s*#?\d+$/i,
    /^resume$/i,
    /^applicant$/i,
    /^unnamed$/i,
    /^null$/i,
    /^undefined$/i,
  ];

  if (unreliablePatterns.some((pattern) => pattern.test(lower))) {
    return false;
  }

  // Must contain letters and not just symbols/digits
  if (!/[a-zA-Z]/.test(trimmed)) {
    return false;
  }

  return true;
}

export function formatCandidateDisplayName(
  candidateId: string,
  candidateName?: string | null
): string {
  if (candidateName && isReliableCandidateName(candidateName)) {
    const cleanName = candidateName.trim();
    // Prevent duplicate ID if candidateName already includes it
    if (cleanName.toLowerCase().includes(`(${candidateId.toLowerCase()})`)) {
      return cleanName;
    }
    // If candidateName matches candidateId, avoid "CV273 (CV273)"
    if (cleanName.toLowerCase() === candidateId.toLowerCase()) {
      return candidateId;
    }
    return `${cleanName} (${candidateId})`;
  }
  return candidateId;
}

export function ensureUniqueCandidateIds<T extends { filename: string; candidateId?: string }>(
  items: T[]
): (T & { candidateId: string })[] {
  const seen = new Map<string, number>();

  return items.map((item, index) => {
    let baseId = item.candidateId || extractCandidateId(item.filename, index);
    if (!baseId || baseId.trim() === "") {
      baseId = `CV${index + 1}`;
    }

    const count = seen.get(baseId) || 0;
    seen.set(baseId, count + 1);

    const uniqueId = count === 0 ? baseId : `${baseId}-${count + 1}`;
    return {
      ...item,
      candidateId: uniqueId,
    };
  });
}
