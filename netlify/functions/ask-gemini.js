import { Pool } from "pg";
import { GoogleGenerativeAI } from "@google/generative-ai";
import prompts from "./prompts.js";

// --- Database & AI Clients ---
const pool = new Pool({ connectionString: process.env.NETLIFY_DATABASE_URL });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const embeddingModel = genAI.getGenerativeModel({ model: "embedding-001" });
const reasoningModel = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

// --- Helper Functions ---
function cosineSimilarity(vecA, vecB) {
  const dot = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
  const magA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
  const magB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
  return dot / (magA * magB);
}

async function logInteraction(question, ruleSet, situation, candidates, selected, answer) {
    const client = await pool.connect();
    try {
        await client.query(
            `INSERT INTO query_logs (user_question, ruleset, situation_analysis, candidate_rules, selected_rule, ai_answer) VALUES ($1, $2, $3, $4, $5, $6)`,
            [question, ruleSet, JSON.stringify(situation), JSON.stringify(candidates), selected, answer]
        );
        console.log("Interaction logged to DB.");
    } catch (e) {
        console.error("Logging failed (non-fatal):", e);
    } finally {
        client.release();
    }
}

// === MAIN HANDLER ===
export async function handler(event) {
    console.log('--- ask-gemini HANDLER STARTED ---');
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

    try {
        const { question, ruleSet } = JSON.parse(event.body);
        console.log(`--- NEW QUERY: ${question} (${ruleSet}) ---`);

        // --- Step 1: Retrieval (RAG) - Get the Top 5 Candidates ---
        const embeddingResponse = await embeddingModel.embedContent({ content: { parts: [{ text: question }] } });
        const queryEmbedding = embeddingResponse.embedding.values;

        const { rows } = await pool.query(`SELECT id, content, embedding FROM rulebooks WHERE ruleset = $1`, [ruleSet]);
        
        const matches = rows.map(row => ({
            ...row,
            embedding: JSON.parse(row.embedding),
            score: cosineSimilarity(queryEmbedding, JSON.parse(row.embedding))
        }));

        const topCandidates = matches.sort((a, b) => b.score - a.score).slice(0, 5);

        if (topCandidates.length === 0) {
            return { statusCode: 200, body: JSON.stringify({ answer: "I'm sorry, I couldn't find any relevant rules for that question. Please try rephrasing it." }) };
        }

        // --- Step 2: Single-Call Reasoning (Analyst, Committee, and Responder in one prompt) ---
       // --- Step 2: Single-Call Reasoning (Analyst, Committee, and Responder in one prompt) ---
        const systemPersona = prompts[ruleSet] || prompts.default;
        
        const singleCallPrompt = `
            ${systemPersona}

            **INTERNAL REASONING PROCESS (DO NOT SHOW THIS TO THE USER):**
            You will perform a three-step reasoning process internally before formulating your final answer.
            
            1.  **Situational Analysis:**
                Analyze the user's question: "${question}"
                Identify the core baseball concepts, game state (if any), and specific rule being asked about.

            2.  **Adjudication:**
                Review the following ${topCandidates.length} candidate rules retrieved from the rulebook. Select the single most relevant rule text that directly answers the user's question based on your analysis.
                CANDIDATE RULES:
                ${topCandidates.map((r, i) => `[CANDIDATE ${i+1}]:\n${r.content}`).join("\n\n")}

            3.  **Answer Formulation:**
                Using ONLY the single rule you selected in Step 2, formulate a final answer.
            
            ---
            **FINAL OUTPUT TO USER:**
            Your entire output must STRICTLY follow the two-part response structure below. Do not include your internal reasoning steps (Analysis, Adjudication, etc.) in the final output.

            **Response Structure:**

            **Part 1: The Explanation**
            Provide a clear, conversational, and authoritative answer to the user's question. Use **bold text** for key terms.
            
            **Part 2: The Rulebook Quotation**
            Provide a section titled "**Official Rulebook Text:**". Quote word-for-word the single rule you selected in Step 2. Use proper citation if available in the text.
        `;

        const result = await reasoningModel.generateContent(singleCallPrompt);
        const aiAnswer = result.response.text();
        
        console.log("--- FINAL ANSWER GENERATED ---");

        // We can't know the exact "thought process" with a single call, so we log what we have.
        // For more detailed logging, we would need to go back to multi-call.
        // This is the trade-off for speed.
        await logInteraction(question, ruleSet, { query: question }, topCandidates, "Combined in single call", aiAnswer);
        
        return { statusCode: 200, body: JSON.stringify({ answer: aiAnswer }) };

    } catch (error) {
        console.error("ERROR in ask-gemini.js:", error);

  // --- NEW: Check for specific 429 error ---
    if (error.status === 429) {
      return {
        statusCode: 429, // Send the 429 status code back to the frontend
        body: JSON.stringify({ error: "Too many requests. Please wait a moment and try again." })
      };
    }
    // --- END NEW ---

        return { statusCode: 500, body: JSON.stringify({ error: "Sorry, an internal error occurred. The AI failed to generate a response." }) };
    }
}