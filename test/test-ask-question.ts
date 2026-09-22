import { askQuestion } from "../lib/gemini";
require("dotenv").config({ path: ".env" });

async function test() {
  try {
    const res = await askQuestion(
      "What is the candidate name",
      "Software Engineer position requiring React and Node.js",
      [
        {
          candidateId: "CV273",
          candidateName: "",
          displayName: "CV273",
          resumeFilename: "CV273.pdf",
          evaluationReasoning: "Good skills in React",
          overallScore: 92,
          recommendation: "Strong Match",
          scoreBreakdown: { skills: 90, experience: 90, education: 90, projects: 90, keywords: 90, formatting: 90 },
          matchedSkills: ["React", "Node.js"],
          missingSkills: [],
          strengths: ["Experienced in fullstack"],
          improvements: [],
          summary: "Strong candidate",
          suggestedResume: {
            professionalSummary: "Summary",
            skills: ["React"],
            experienceSuggestions: [],
            projectSuggestions: [],
            certificationSuggestions: [],
            keywordSuggestions: []
          }
        }
      ],
      [
        {
          filename: "CV273.pdf",
          text: "Senior Software Engineer with 5 years experience in React and Node.js. Contact: dev@example.com"
        }
      ]
    );
    console.log("SUCCESS! Response:\n", res);
  } catch (err) {
    console.error("FAILED with error:\n", err);
  }
}

test();
