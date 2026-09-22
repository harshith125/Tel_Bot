import { GoogleGenAI, Type } from "@google/genai";
import type { ResumeAnalysis } from "@/types/analysis";
import {
  extractCandidateId,
  formatCandidateDisplayName,
  isReliableCandidateName,
} from "./candidate-utils";

let _aiClient: GoogleGenAI | null = null;

function getAiClient(): GoogleGenAI {
  if (_aiClient) return _aiClient;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is missing from environment variables.",
    );
  }
  _aiClient = new GoogleGenAI({ apiKey });
  return _aiClient;
}

const MODEL_CANDIDATES = Array.from(
  new Set(
    [
      process.env.GEMINI_MODEL,
      "gemini-3.1-flash-lite",
      "gemini-3-flash-preview",
      "gemini-flash-lite-latest",
      "gemini-3.5-flash-lite",
      "gemini-3.6-flash",
      "gemini-3.7-flash",
      "gemini-3.5-flash",
    ].filter(
      (model): model is string =>
        typeof model === "string" && model.length > 0,
    )
  )
);

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    candidateName: {
      type: Type.STRING,
      description:
        "The candidate's real full name ONLY if explicitly and reliably present in the CV. If anonymous or no reliable name is found, return an empty string. NEVER return 'Anonymous', 'Unknown', 'N/A', or infer/guess a name.",
    },
    resumeFilename: {
      type: Type.STRING,
    },
    evaluationReasoning: {
      type: Type.STRING,
      description:
        "Detailed step-by-step reasoning evaluating the candidate against the JD before giving a score.",
    },
    overallScore: {
      type: Type.INTEGER,
    },
    recommendation: {
      type: Type.STRING,
      enum: [
        "Strong Match",
        "Good Match",
        "Moderate Match",
        "Weak Match",
        "Not Suitable",
      ],
    },
    scoreBreakdown: {
      type: Type.OBJECT,
      properties: {
        skills: {
          type: Type.INTEGER,
        },
        experience: {
          type: Type.INTEGER,
        },
        education: {
          type: Type.INTEGER,
        },
        projects: {
          type: Type.INTEGER,
        },
        keywords: {
          type: Type.INTEGER,
        },
        formatting: {
          type: Type.INTEGER,
        },
      },
      required: [
        "skills",
        "experience",
        "education",
        "projects",
        "keywords",
        "formatting",
      ],
    },
    matchedSkills: {
      type: Type.ARRAY,
      items: {
        type: Type.STRING,
      },
    },
    missingSkills: {
      type: Type.ARRAY,
      items: {
        type: Type.STRING,
      },
    },
    strengths: {
      type: Type.ARRAY,
      items: {
        type: Type.STRING,
      },
    },
    improvements: {
      type: Type.ARRAY,
      items: {
        type: Type.STRING,
      },
    },
    summary: {
      type: Type.STRING,
    },
    suggestedResume: {
      type: Type.OBJECT,
      properties: {
        professionalSummary: {
          type: Type.STRING,
        },
        skills: {
          type: Type.ARRAY,
          items: {
            type: Type.STRING,
          },
        },
        experienceSuggestions: {
          type: Type.ARRAY,
          items: {
            type: Type.STRING,
          },
        },
        projectSuggestions: {
          type: Type.ARRAY,
          items: {
            type: Type.STRING,
          },
        },
        certificationSuggestions: {
          type: Type.ARRAY,
          items: {
            type: Type.STRING,
          },
        },
        keywordSuggestions: {
          type: Type.ARRAY,
          items: {
            type: Type.STRING,
          },
        },
      },
      required: [
        "professionalSummary",
        "skills",
        "experienceSuggestions",
        "projectSuggestions",
        "certificationSuggestions",
        "keywordSuggestions",
      ],
    },
  },
  required: [
    "candidateName",
    "resumeFilename",
    "evaluationReasoning",
    "overallScore",
    "recommendation",
    "scoreBreakdown",
    "matchedSkills",
    "missingSkills",
    "strengths",
    "improvements",
    "summary",
    "suggestedResume",
  ],
};

function clampScore(value: unknown): number {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(number)));
}

function normalizeResult(
  result: ResumeAnalysis,
  filename: string,
  candidateId: string,
): ResumeAnalysis {
  const rawName = result.candidateName?.trim() || "";
  const reliableName = isReliableCandidateName(rawName) ? rawName : "";
  const displayName = formatCandidateDisplayName(candidateId, reliableName);

  return {
    ...result,
    candidateId,
    candidateName: reliableName,
    displayName,
    resumeFilename: filename,
    overallScore: clampScore(result.overallScore),

    scoreBreakdown: {
      skills: clampScore(result.scoreBreakdown?.skills),
      experience: clampScore(
        result.scoreBreakdown?.experience,
      ),
      education: clampScore(
        result.scoreBreakdown?.education,
      ),
      projects: clampScore(
        result.scoreBreakdown?.projects,
      ),
      keywords: clampScore(
        result.scoreBreakdown?.keywords,
      ),
      formatting: clampScore(
        result.scoreBreakdown?.formatting,
      ),
    },

    matchedSkills: result.matchedSkills ?? [],
    missingSkills: result.missingSkills ?? [],
    strengths: result.strengths ?? [],
    improvements: result.improvements ?? [],

    suggestedResume: {
      professionalSummary:
        result.suggestedResume?.professionalSummary ?? "",
      skills: result.suggestedResume?.skills ?? [],
      experienceSuggestions:
        result.suggestedResume?.experienceSuggestions ?? [],
      projectSuggestions:
        result.suggestedResume?.projectSuggestions ?? [],
      certificationSuggestions:
        result.suggestedResume
          ?.certificationSuggestions ?? [],
      keywordSuggestions:
        result.suggestedResume?.keywordSuggestions ?? [],
    },
  };
}

function shouldFailover(error: unknown): boolean {
  if (!error) return false;
  const message =
    error instanceof Error
      ? error.message.toLowerCase()
      : String(error).toLowerCase();

  const status =
    (error as any)?.status ||
    (error as any)?.code ||
    (error as any)?.error?.code;

  return (
    status === 404 ||
    status === 429 ||
    status === 500 ||
    status === 503 ||
    status === 504 ||
    message.includes("404") ||
    message.includes("429") ||
    message.includes("500") ||
    message.includes("503") ||
    message.includes("504") ||
    message.includes("not_found") ||
    message.includes("not found") ||
    message.includes("no longer available") ||
    message.includes("unsupported model") ||
    message.includes("high demand") ||
    message.includes("resource_exhausted") ||
    message.includes("quota") ||
    message.includes("rate limit") ||
    message.includes("unavailable") ||
    message.includes("overloaded") ||
    message.includes("temporarily unavailable") ||
    message.includes("try again later")
  );
}

export async function analyzeResume(
  jobDescription: string,
  resumeFilename: string,
  resumeText: string,
  candidateId?: string,
): Promise<{
  result: ResumeAnalysis;
  modelUsed: string;
}> {
  const effectiveCandidateId =
    candidateId || extractCandidateId(resumeFilename);

  const prompt = `
You are an experienced ATS evaluator and technical recruiter.

Compare the candidate's resume with the job description.

CANDIDATE IDENTIFICATION RULES:
1. Extract candidate's real name from the resume ONLY when the name is explicitly and reliably present.
2. If no reliable name is detected (e.g. anonymous CV or name not provided), return an empty string "" for candidateName. DO NOT use "Anonymous", "Unknown", "N/A", "Candidate", or similar placeholders as candidateName.
3. NEVER hallucinate, infer, or guess a person's name from incomplete information.
4. Candidate ID is: ${effectiveCandidateId}. Preserve this identifier.

STRICT EVALUATION RULES:
1. Use only information present in the resume.
2. Never invent experience, education, projects, results,
   certifications or technical skills.
3. Scores must be realistic and between 0 and 100.
   CRITICAL: Differentiate candidates. Do not default to the same score for everyone.
4. A missing skill is a JD requirement not clearly found
   in the resume.
5. Suggestions may recommend better wording and structure.
6. Never tell the candidate to falsely claim knowledge.
7. The suggested resume must preserve only truthful
   information from the original resume.
8. Suggested skills can contain:
   - existing skills from the resume, or
   - skills clearly marked as "learn before adding".
9. Keep recommendations specific to this JD.
10. Return only the structured JSON result. YOU MUST write out your \`evaluationReasoning\` BEFORE outputting the \`overallScore\`.

SCORING GUIDANCE:
- Skills: alignment of required and preferred skills
- Experience: relevance and depth of work/internships
- Education: alignment with educational requirements
- Projects: relevance, technical depth and outcomes
- Keywords: JD terminology that truthfully appears
- Formatting: clarity, structure and ATS readability

JOB DESCRIPTION:
${jobDescription.slice(0, 35_000)}

CANDIDATE ID:
${effectiveCandidateId}

RESUME FILENAME:
${resumeFilename}

RESUME CONTENT:
${resumeText.slice(0, 35_000)}
`;

  let lastError: unknown;

  for (const model of MODEL_CANDIDATES) {
    try {
      const response = await getAiClient().models.generateContent({
        model,
        contents: prompt,
        config: {
          temperature: 0.15,
          responseMimeType: "application/json",
          responseSchema,
        },
      });

      if (!response.text) {
        throw new Error(
          `${model} returned an empty response.`,
        );
      }

      const parsed = JSON.parse(
        response.text,
      ) as ResumeAnalysis;

      return {
        result: normalizeResult(
          parsed,
          resumeFilename,
          effectiveCandidateId,
        ),
        modelUsed: model,
      };
    } catch (error) {
      lastError = error;

      console.error(
        `Gemini model ${model} failed:`,
        error,
      );

      if (!shouldFailover(error)) {
        throw error;
      }
    }
  }

  throw new Error(
    "None of the configured Gemini models are available. " +
      `Last error: ${
        lastError instanceof Error
          ? lastError.message
          : String(lastError)
      }`,
  );
}

export async function askQuestion(
  question: string,
  jobDescription: string,
  analysisResults: ResumeAnalysis[],
  resumes: { filename: string; text: string; candidateId?: string }[]
): Promise<string> {
  const rawResumesText = resumes
    .map((r, index) => {
      const id = r.candidateId || extractCandidateId(r.filename, index);
      return `--- CANDIDATE ID: ${id} | FILENAME: ${r.filename} ---\n${r.text}`;
    })
    .join("\n\n");

  const candidatesSummary = analysisResults.map((res) => ({
    candidateId: res.candidateId,
    candidateName: res.candidateName || undefined,
    displayName: res.displayName,
    resumeFilename: res.resumeFilename,
    overallScore: res.overallScore,
    recommendation: res.recommendation,
    scoreBreakdown: res.scoreBreakdown,
    matchedSkills: res.matchedSkills,
    missingSkills: res.missingSkills,
    strengths: res.strengths,
    improvements: res.improvements,
    summary: res.summary,
    evaluationReasoning: res.evaluationReasoning,
  }));

  const prompt = `
You are an expert technical recruiter and ATS specialist answering a hiring manager's questions.

CRITICAL CANDIDATE IDENTIFICATION & RESOLUTION:
1. Each candidate is uniquely identified by their Candidate ID (e.g. CV273, CV390) and Display Name (e.g. "CV273" or "John Doe (CV273)").
2. When the hiring manager asks questions referencing a Candidate ID (e.g., "Tell me more about CV273", "Why did CV390 get a low score?", "Compare CV273 and CV390"), accurately resolve that candidate using their Candidate ID.
3. In your response, refer to candidates using their Display Name (e.g. "CV273" or "John Doe (CV273)").

CRITICAL FORMATTING RULES:
1. DO NOT use Markdown tables (they are not supported by the platform).
2. Format your response using ONLY Telegram-supported HTML tags: <b>bold</b>, <i>italic</i>, <code>code</code>, <pre>preformatted</pre>.
3. Use emojis (📊, 👤, ⚠️, ✅, etc.) to make the output look professional and structured.
4. For rankings or summaries, use clean bullet points or numbered lists instead of tables.
5. Structure your response clearly with bold headings and separate sections with spacing.

Below you will find the RAW RESUME TEXT of the candidates (labeled with CANDIDATE ID and FILENAME), followed by the AI-generated CANDIDATES ANALYSIS, and the JOB DESCRIPTION.
You MUST search the RAW RESUME TEXT to answer specific questions (like CGPA, phone numbers, exact dates, etc.) that might not be in the summary.

RAW CANDIDATES RESUME TEXT:
${rawResumesText.slice(0, 40000)}

CANDIDATES ANALYSIS (Summaries, IDs, and Scores):
${JSON.stringify(candidatesSummary, null, 2).slice(0, 20000)}

JOB DESCRIPTION:
${jobDescription.slice(0, 15000)}

HIRING MANAGER'S QUESTION:
${question}
  `;

  let lastError: unknown;

  for (const model of MODEL_CANDIDATES) {
    try {
      const response = await getAiClient().models.generateContent({
        model,
        contents: prompt,
        config: {
          temperature: 0.3,
        },
      });

      if (!response.text) {
        throw new Error(`${model} returned an empty response.`);
      }

      return response.text;
    } catch (error) {
      lastError = error;
      console.error(`Gemini model ${model} failed in Q&A:`, error);
      if (!shouldFailover(error)) {
        throw error;
      }
    }
  }

  throw new Error(
    "None of the configured Gemini models are available for Q&A. " +
      `Last error: ${
        lastError instanceof Error
          ? lastError.message
          : String(lastError)
      }`,
  );
}
