export interface ScoreBreakdown {
  skills: number;
  experience: number;
  education: number;
  projects: number;
  keywords: number;
  formatting: number;
}

export interface SuggestedResume {
  professionalSummary: string;
  skills: string[];
  experienceSuggestions: string[];
  projectSuggestions: string[];
  certificationSuggestions: string[];
  keywordSuggestions: string[];
}

export interface ResumeAnalysis {
  candidateId: string;
  candidateName: string;
  displayName: string;
  resumeFilename: string;
  evaluationReasoning: string;
  overallScore: number;
  recommendation:
    | "Strong Match"
    | "Good Match"
    | "Moderate Match"
    | "Weak Match"
    | "Not Suitable"
    | "Analysis Error";

  scoreBreakdown: ScoreBreakdown;

  matchedSkills: string[];
  missingSkills: string[];
  strengths: string[];
  improvements: string[];

  summary: string;
  suggestedResume: SuggestedResume;
}

export interface AnalyzeResponse {
  success: boolean;
  jobDescriptionSource: string;
  totalResumes: number;
  results: ResumeAnalysis[];
  modelUsed?: string;
  error?: string;
}
