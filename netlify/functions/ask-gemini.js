// === ask-gemini.js ===
// Description: Handles incoming rulebook + glossary queries using Gemini + Neon pg JSONB embeddings
// Optimized: Weighted snippet selection using JS cosine similarity

import { Pool } from "pg";
import { GoogleGenerativeAI } from "@google/generative-ai";
import prompts from "./prompts.js";

// === STEP 1: INITIALIZE DATABASE + GEMINI MODELS ===
const pool = new Pool({ connectionString: process.env.NETLIFY_DATABASE_URL });

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const generativeModel = genAI.getGenerativeModel({ model: "gemini-pro" });
const embeddingModel = genAI.getGenerativeModel({ model: "embedding-001" });

// === UTILITY: COSINE SIMILARITY ===
function cosineSimilarity(vecA, vecB) {
  const dot = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
  const magA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
  const magB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
  return magA && magB ? dot / (magA * magB) : 0;
}

// === STEP 2: MAIN HANDLER ===
export async function handler(event) {
  try {
    const { question, ruleSet } = JSON.parse(event.body);
    console.log("=== Incoming Question ===", question);
    console.log("Using Rule Set:", ruleSet);

    // === STEP 3: CREATE EMBEDDING FOR USER QUESTION ===
    const embeddingResponse = await embeddingModel.embedContent({
      content: { parts: [{ text: question }] }
    });
    const queryEmbedding = embeddingResponse.embedding.values;

    // === STEP 4: FETCH RULEBOOK + GLOSSARY ===
    const { rows: rulebookRows } = await pool.query(
      `SELECT id, content, ruleset, embedding 
       FROM rulebooks 
       WHERE ruleset = $1`, 
      [ruleSet]
    );

    const { rows: glossaryRows } = await pool.query(
      `SELECT content AS text 
       FROM rulebooks 
       WHERE ruleset = 'Glossary'`
    );

    // === STEP 5: COMPUTE SIMILARITY IN JS ===
    const rulebookMatches = rulebookRows
      .map(r => {
        const dbEmbedding = r.embedding; // JSONB array
        const score = cosineSimilarity(queryEmbedding, dbEmbedding);
        return { ...r, score };
      })
      .sort((a, b) => b.score - a.score);

    const glossaryDefinitions = glossaryRows
      .map(row => `• ${row.text}`)
      .join("\n") || "No glossary terms available.";

    // === STEP 6: FILTER LOW-SIMILARITY RESULTS ===
    const SIMILARITY_THRESHOLD = 0.65;
    const relevantMatches = rulebookMatches.filter(m => m.score > SIMILARITY_THRESHOLD);

    console.log("=== DEBUG: Vector Search ===");
    console.log("Relevant Matches:", relevantMatches.length);
    console.log("Glossary Terms Retrieved:", glossaryRows.length);

    if (relevantMatches.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          answer: `I couldn't find a rule in the ${ruleSet} documents that matches your question. Please try rephrasing it.`
        })
      };
    }

    // === STEP 7: WEIGHTED RANKING VIA GEMINI ===
    const weightedRankingPrompt = `
You are helping to rank rulebook snippets for relevance.
The user asked: "${question}"

Each snippet includes a **similarity score** (from 0 to 1). 
Higher scores mean the snippet is more likely relevant. Use these scores as your primary ranking signal.
If two snippets have close scores, resolve ties using semantic relevance to the user's question.

Return ONLY the top 3 snippets. Do NOT include any explanations.

SNIPPETS:
${relevantMatches
      .slice(0, 10)
      .map((m, i) => `[${i + 1}] (Score: ${m.score.toFixed(4)}) ${m.content}`)
      .join("\n\n")}`;

    const rankingResult = await generativeModel.generateContent(weightedRankingPrompt);
    const selectedSnippets = await rankingResult.response.text();

    // === STEP 8: BUILD FINAL PROMPT ===
    const selectedPrompt = prompts[ruleSet] || prompts.default;
    const finalPrompt = `${selectedPrompt}

**Your Task:**
You will be given a user's question and the **3 most relevant rulebook snippets**, plus glossary definitions.
Follow these steps:
1. Review the provided snippets carefully.
2. Use them to produce a conversational, authoritative answer.
3. Do NOT invent rules; only use what is in the snippets.

**Glossary Definitions:**
${glossaryDefinitions}

---
CONTEXT FROM RULEBOOK (Top 3 Snippets, Weighted by Score):
${selectedSnippets}
---

USER'S QUESTION (Answer according to ${ruleSet} rules):
${question}`;

    // === STEP 9: SEND FINAL PROMPT TO GEMINI ===
    console.log("=== Sending Final Prompt to Gemini ===");
    const generationResult = await generativeModel.generateContent(finalPrompt);
    const aiAnswer = await generationResult.response.text();

    console.log("=== AI FINAL RESPONSE ===");
    console.log(aiAnswer);

    return {
      statusCode: 200,
      body: JSON.stringify({ answer: aiAnswer })
    };

  } catch (error) {
    console.error("=== ERROR IN ask-gemini.js ===", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Internal Server Error", details: error.message })
    };
  }
}
