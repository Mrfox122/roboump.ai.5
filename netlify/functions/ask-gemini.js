// === ask-gemini.js ===
// Description: Handles incoming rulebook + glossary queries using Gemini + Neon pgvector
// Optimized: Weighted snippet selection using pgvector similarity + semantic context

import { Pool } from "pg";
import { GoogleGenerativeAI } from "@google/generative-ai";
import prompts from "./prompts.js";

// === STEP 1: INITIALIZE DATABASE + GEMINI MODELS ===
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const generativeModel = genAI.getGenerativeModel({ model: "gemini-pro" });
const embeddingModel = genAI.getGenerativeModel({ model: "embedding-001" });

// === STEP 2: MAIN HANDLER ===
export async function handler(event) {
    try {
        // === Parse Input ===
        const { question, ruleSet } = JSON.parse(event.body);
        console.log("=== Incoming Question ===", question);
        console.log("Using Rule Set:", ruleSet);

        // === STEP 3: CREATE EMBEDDING FOR USER QUESTION ===
        const embeddingResponse = await embeddingModel.embedContent({
            content: { parts: [{ text: question }] }
        });
        const queryEmbedding = embeddingResponse.embedding.values;

        // === STEP 4: PERFORM RULEBOOK VECTOR SEARCH ===
        console.log("=== Performing Rulebook Vector Search ===");
        const { rows: rulebookMatches } = await pool.query(
            `SELECT id, text, rule_set, 1 - (embedding <=> $1) AS score
             FROM rulebook_snippets
             WHERE rule_set = $2
             ORDER BY embedding <=> $1
             LIMIT 10;`,
            [queryEmbedding, ruleSet]
        );

        // === STEP 5: PERFORM GLOSSARY VECTOR SEARCH ===
        console.log("=== Performing Glossary Vector Search ===");
        const { rows: glossaryMatches } = await pool.query(
            `SELECT term, text, 1 - (embedding <=> $1) AS score
             FROM rulebook_snippets
             WHERE rule_set = 'Glossary'
             ORDER BY embedding <=> $1
             LIMIT 150;`,
            [queryEmbedding]
        );

        // Build glossary context for AI
        const glossaryDefinitions = glossaryMatches
            .map(row => `• ${row.term}: ${row.text}`)
            .join("\n") || "No glossary terms available.";

        // === STEP 6: FILTER OUT LOW-SIMILARITY RESULTS ===
        const SIMILARITY_THRESHOLD = 0.65;
        const relevantMatches = rulebookMatches.filter(m => m.score > SIMILARITY_THRESHOLD);

        console.log("=== DEBUG: Vector Search ===");
        console.log("Relevant Matches:", relevantMatches.length);
        console.log("Glossary Terms Retrieved:", glossaryMatches.length);

        // If no matches, return fallback message
        if (relevantMatches.length === 0) {
            return {
                statusCode: 200,
                body: JSON.stringify({
                    answer: `I couldn't find a rule in the ${ruleSet} documents that matches your question. Please try rephrasing it.`
                })
            };
        }

        // === STEP 7: WEIGHTED SEMANTIC + VECTOR RANKING ===
        console.log("=== Asking Gemini to Rank Snippets by Weighted Relevance ===");

        const weightedRankingPrompt = `
You are helping to rank rulebook snippets for relevance.
The user asked: "${question}"

Each snippet includes a **similarity score** (from 0 to 1). 
Higher scores mean the snippet is more likely relevant. Use these scores as your primary ranking signal.
If two snippets have close scores, resolve ties using semantic relevance to the user's question.

Return ONLY the top 3 snippets. Do NOT include any explanations.

SNIPPETS:
${relevantMatches
    .map(
        (m, i) =>
            `[${i + 1}] (Score: ${m.score.toFixed(4)}) ${m.text}`
    )
    .join("\n\n")}`;

        const rankingResult = await generativeModel.generateContent(weightedRankingPrompt);
        const selectedSnippets = await rankingResult.response.text();

        console.log("=== Gemini Selected Snippets ===");
        console.log(selectedSnippets);

        // === STEP 8: BUILD FINAL PROMPT USING SELECTED SNIPPETS ===
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

        // === STEP 10: RETURN ANSWER ===
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
