// === ask-gemini.js ===
// Description: Handles incoming rulebook + glossary queries using Gemini + Neon JSONB
// Optimized: Weighted snippet selection using cosine similarity + semantic context

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
    return dot / (magA * magB);
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

        // === STEP 4: FETCH RULEBOOK AND GLOSSARY ENTRIES ===
        const { rows: rulebookRows } = await pool.query(
            "SELECT id, content, ruleset, embedding FROM rulebooks WHERE ruleset = $1",
            [ruleSet]
        );

        const { rows: glossaryRows } = await pool.query(
            "SELECT content AS text, term FROM rulebooks WHERE ruleset = 'Glossary' LIMIT 150"
        );

        // Parse JSONB embeddings
        const rulebookMatches = rulebookRows.map(row => ({
            ...row,
            embedding: typeof row.embedding === "string" ? JSON.parse(row.embedding) : row.embedding
        }));

        // Compute similarity scores in JS
        rulebookMatches.forEach(row => {
            row.score = cosineSimilarity(queryEmbedding, row.embedding);
        });

        // Build glossary context
        const glossaryDefinitions = glossaryRows
            .map(row => `• ${row.term}: ${row.text}`)
            .join("\n") || "No glossary terms available.";

        // Filter low-similarity matches
        const SIMILARITY_THRESHOLD = 0.65;
        const relevantMatches = rulebookMatches
            .filter(m => m.score > SIMILARITY_THRESHOLD)
            .sort((a, b) => b.score - a.score)
            .slice(0, 10); // top 10 matches

        console.log("Relevant Matches:", relevantMatches.length);

        if (relevantMatches.length === 0) {
            return {
                statusCode: 200,
                body: JSON.stringify({
                    answer: `I couldn't find a rule in the ${ruleSet} documents that matches your question. Please try rephrasing it.`
                })
            };
        }

        // === STEP 5: WEIGHTED SEMANTIC RANKING ===
        const weightedRankingPrompt = `
You are helping to rank rulebook snippets for relevance.
The user asked: "${question}"

Each snippet includes a **similarity score** (from 0 to 1). 
Higher scores mean the snippet is more likely relevant. Use these scores as your primary ranking signal.
If two snippets have close scores, resolve ties using semantic relevance to the user's question.

Return ONLY the top 3 snippets. Do NOT include any explanations.

SNIPPETS:
${relevantMatches
    .map((m, i) => `[${i + 1}] (Score: ${m.score.toFixed(4)}) ${m.content}`)
    .join("\n\n")}`;

        const rankingResult = await generativeModel.generateContent(weightedRankingPrompt);
        const selectedSnippets = await rankingResult.response.text();

        // === STEP 6: BUILD FINAL PROMPT ===
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

        // === STEP 7: SEND FINAL PROMPT TO GEMINI ===
        const generationResult = await generativeModel.generateContent(finalPrompt);
        const aiAnswer = await generationResult.response.text();

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
