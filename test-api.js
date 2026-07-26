const { GoogleGenAI, Type } = require("@google/genai");
require("dotenv").config({ path: ".env" });

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function run() {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: "Hello world!",
    });
    console.log("Success with gemini-2.0-flash!", response.text);
  } catch (error) {
    console.error("Error gemini-2.0-flash:", error);
  }
}
run();
