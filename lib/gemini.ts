import { GoogleGenAI, Type } from "@google/genai";
import type { ResumeAnalysis } from "@/types/analysis";

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  throw new Error(
    "GEMINI_API_KEY is missing from .env.local.",
  );
}

const ai = new GoogleGenAI({
  apiKey,
});

const MODEL_CANDIDATES = [
  process.env.GEMINI_MODEL,
  "gemini-3.1-flash-lite",
  "gemini-3.5-flash",
  "gemini-2.5-flash-lite-latest",
  "gemini-2.0-flash",
].filter(
  (model): model is string =>
    typeof model === "string" && model.length > 0,
);

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    candidateName: {
      type: Type.STRING,
    },
    resumeFilename: {
      type: Type.STRING,
    },
    evaluationReasoning: {
      type: Type.STRING,
      description: "Detailed step-by-step reasoning evaluating the candidate against the JD before giving a score.",
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
): ResumeAnalysis {
  return {
    ...result,
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

function isModelUnavailable(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message.toLowerCase()
      : String(error).toLowerCase();

  return (
    message.includes("404") ||
    message.includes("not_found") ||
    message.includes("not found") ||
    message.includes("no longer available") ||
    message.includes("unsupported model")
  );
}

export async function analyzeResume(
  jobDescription: string,
  resumeFilename: string,
  resumeText: string,
): Promise<{
  result: ResumeAnalysis;
  modelUsed: string;
}> {
  const prompt = `
You are an experienced ATS evaluator and technical recruiter.

Compare the candidate's resume with the job description.

STRICT RULES:

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

RESUME FILENAME:
${resumeFilename}

RESUME CONTENT:
${resumeText.slice(0, 35_000)}
`;

  let lastError: unknown;

  for (const model of MODEL_CANDIDATES) {
    try {
      const response = await ai.models.generateContent({
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
        result: normalizeResult(parsed, resumeFilename),
        modelUsed: model,
      };
    } catch (error) {
      lastError = error;

      console.error(
        `Gemini model ${model} failed:`,
        error,
      );

      if (!isModelUnavailable(error)) {
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
  resumes: { filename: string; text: string }[]
): Promise<string> {
  const rawResumesText = resumes.map(r => `--- RESUME: ${r.filename} ---\n${r.text}`).join("\n\n");
  const prompt = `
You are an expert technical recruiter and ATS specialist answering a hiring manager's questions.

CRITICAL FORMATTING RULES:
1. DO NOT use Markdown tables (they are not supported by the platform).
2. Format your response using ONLY Telegram-supported HTML tags: <b>bold</b>, <i>italic</i>, <code>code</code>, <pre>preformatted</pre>.
3. Use emojis (📊, 👤, ⚠️, ✅, etc.) to make the output look professional and structured.
4. For rankings or summaries, use clean bullet points or numbered lists instead of tables.
5. Structure your response clearly with bold headings and separate sections with spacing.

Below you will find the RAW RESUME TEXT of the candidates, followed by the AI-generated CANDIDATES ANALYSIS, and the JOB DESCRIPTION.
You MUST search the RAW RESUME TEXT to answer specific questions (like CGPA, phone numbers, exact dates, etc.) that might not be in the summary.

RAW CANDIDATES RESUME TEXT:
${rawResumesText.slice(0, 40000)}

CANDIDATES ANALYSIS (Summaries and Scores):
${JSON.stringify(analysisResults, null, 2).slice(0, 20000)}

JOB DESCRIPTION:
${jobDescription.slice(0, 15000)}

HIRING MANAGER'S QUESTION:
${question}
  `;

  for (const model of MODEL_CANDIDATES) {
    try {
      const response = await ai.models.generateContent({
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
      if (!isModelUnavailable(error)) {
        throw error;
      }
    }
  }

  throw new Error("None of the configured Gemini models are available for Q&A.");
}
