const { GoogleGenAI } = require("@google/genai");
require("dotenv").config({ path: ".env" });

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function run() {
  try {
    const models = await ai.models.list();
    console.log("AVAILABLE FLASH MODELS:");
    for await (const model of models) {
      if (model.name.includes("flash")) {
        console.log(model.name);
      }
    }
  } catch (error) {
    console.error("Error listing models:", error);
  }
}
run();
