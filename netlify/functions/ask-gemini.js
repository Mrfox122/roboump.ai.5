// === ask-gemini.js (Netlify Function with Neon JSONB) ===
// Handles rulebook + glossary queries using Gemini + Neon JSONB embeddings

import { Pool } from "pg";
import { GoogleGenerativeAI } from "@google/generative-ai";
import prompts from "./prompts.js";

// === STEP 1: INIT DATABASE + GEMINI ===
const pool = new Pool({ connectionString: process.env.NETLIFY_DATABASE_URL });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const embeddingModel = genAI.getGenerativeModel({ model: "embedding-001" });
const generativeModel = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

// === UTILITY: COSINE SIMILARITY ===
function cosineSimilarity(vecA, vecB) {
  const dot = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
  const magA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
  const magB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
  return dot / (magA * magB);
}

// === MAIN HANDLER ===
export async function handler(event) {
  try {
    const { question, ruleSet } = JSON.parse(event.body);
    console.log("=== Incoming Question ===", question);
    console.log("Using Rule Set:", ruleSet);

    // === STEP 2: FETCH GLOSSARY ===
    const { rows: glossaryRows } = await pool.query(`
      SELECT content, ruleset, embedding, id
      FROM rulebooks
      WHERE ruleset = 'Glossary'
      LIMIT 150
    `);

    // Build glossary context for AI
    const glossaryDefinitions = glossaryRows
      .map(row => `• ${row.content}`)
      .join("\n") || "No glossary terms available.";

    // === STEP 3: DETECT SLANG + REPHRASE QUESTION ===
    const slangPrompt = `
You are a baseball language expert. Analyze the user's question using the provided glossary of slang terms.
- Identify slang and provide its definition.
- Rephrase the user's question using official baseball terminology.

Respond in JSON: { "slang_definition": "...", "rephrased_question": "..." }

GLOSSARY:
${glossaryDefinitions}

USER QUESTION: "${question}"
`;
    const slangResult = await generativeModel.generateContent(slangPrompt);
    const slangText = await slangResult.response.text();
    let slangData = { slang_definition: "None", rephrased_question: question };
    try {
      slangData = JSON.parse(slangText.replace(/```json\n?|\n?```/g, ''));
    } catch (e) {
      console.warn("Failed to parse slang analysis, using original question.");
    }
    const { slang_definition, rephrased_question } = slangData;

    console.log("Slang analysis:", slang_definition);
    console.log("Rephrased question:", rephrased_question);

    // === STEP 4: GENERATE MULTIPLE SEARCH QUERIES ===
    const multiQueryPrompt = `
You are a baseball rules expert. Generate 3 alternative search queries for the user's question.
Rephrased Question: "${rephrased_question}"
Respond with 3 queries, one per line.
`;
    const multiQueryResult = await generativeModel.generateContent(multiQueryPrompt);
    const searchQueries = (await multiQueryResult.response.text())
      .split("\n").map(q => q.trim()).filter(Boolean);
    searchQueries.unshift(rephrased_question); // Include main question

    console.log("Search queries:", searchQueries);

    // === STEP 5: EMBEDDING + COSINE SEARCH ===
    const embeddingRequests = searchQueries.map(q => ({
      content: { parts: [{ text: q }] },
      taskType: "RETRIEVAL_QUERY"
    }));
    const embeddingResult = await embeddingModel.batchEmbedContents({ requests: embeddingRequests });
    const queryVectors = embeddingResult.embeddings.map(e => e.values);

    // Fetch rulebook entries
    const { rows: rulebookRows } = await pool.query(
      `SELECT id, content, ruleset, embedding
       FROM rulebooks
       WHERE ruleset = $1`,
      [ruleSet]
    );

    const rulebookMatches = rulebookRows.map(row => ({
      ...row,
      embedding: row.embedding ? (typeof row.embedding === "string" ? JSON.parse(row.embedding) : row.embedding) : []
    }));

    // Compute similarity for all query vectors
    const scoredMatches = [];
    for (const row of rulebookMatches) {
      for (const qVec of queryVectors) {
        const score = cosineSimilarity(qVec, row.embedding);
        scoredMatches.push({ ...row, score });
      }
    }

    const SIMILARITY_THRESHOLD = 0.65;
    const relevantMatches = Array.from(
      new Map(
        scoredMatches
          .filter(m => m.score > SIMILARITY_THRESHOLD)
          .sort((a, b) => b.score - a.score)
          .map(m => [m.id, m])
      ).values()
    ).slice(0, 10);

    if (!relevantMatches.length) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          answer: `I couldn't find a rule in the ${ruleSet} documents that matches your question.`
        })
      };
    }

    const topMatch = relevantMatches[0]; // explicitly mark top match for quoting
    const finalContext = relevantMatches
      .map((m, i) => `Result ${i + 1} (Score: ${m.score.toFixed(4)}):\n${m.content}`)
      .join("\n\n---\n\n");

    // === STEP 6: FINAL PROMPT ===
    const selectedPrompt = prompts[ruleSet] || prompts.default;
    const finalPrompt = `${selectedPrompt}

    Your task is to provide a clear, two-part answer based on the user's ORIGINAL question, using ONLY the provided "CONTEXT FROM RULEBOOK" as your source of truth.

**User's Original Question:** "${question}"
**Internally Rephrased Search Query:** "${rephrased_question}"

**Glossary Definitions (Authoritative):**
${glossaryDefinitions}

**Instructions:**
1. Review ALL the provided text snippets.
2. Decide which snippets are directly relevant to answering the user's question.
3. Synthesize the relevant information into a clear, conversational answer.
4. If multiple snippets are relevant, combine intelligently.
5. Quote the **single most relevant** rule verbatim (use the top match).

**Response Structure:**
Your response must have **two distinct parts**:

**Part 1: The Explanation**
Provide a clear, conversational, and authoritative answer to the user's question.
Use **bold text** for key terms.
Integrate the glossary definitions where appropriate.

**Part 2: The Rulebook Quotation**
Provide a section titled "**Official Rulebook Text:**"
Quote word-for-word the **single most relevant rule** from the top match.
Do not combine it with your explanation.

---
CONTEXT FROM RULEBOOK:
${finalContext}
---

USER'S QUESTION (Answer according to ${ruleSet} rules):
${question}`;


    // === STEP 7: GENERATE AI ANSWER ===
    const generationResult = await generativeModel.generateContent(finalPrompt);
    const aiAnswer = await generationResult.response.text();

    console.log("=== AI RESPONSE ===");
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
