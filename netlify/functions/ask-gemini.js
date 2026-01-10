import { Pool } from "pg";
import { GoogleGenerativeAI } from "@google/generative-ai";
import prompts from "./prompts.js";
import fetch from 'node-fetch';

// --- Clients & Helpers ---
const pool = new Pool({ connectionString: process.env.NETLIFY_DATABASE_URL });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const embeddingModel = genAI.getGenerativeModel({ model: "embedding-001" });
const reasoningModel = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

function cosineSimilarity(vecA, vecB) {
    if (!vecA || !vecB) return 0;
    const dot = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
    const magA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
    const magB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
    if (magA === 0 || magB === 0) return 0;
    return dot / (magA * magB);
}

async function logInteraction(attempt, question, ruleSet, candidates, selected, answer, supervisorVerdict) {
    const client = await pool.connect();
    try {
        const feedback_note = `Attempt #${attempt}: ${supervisorVerdict.reason || 'Final Answer'}`;
        await client.query(
            `INSERT INTO query_logs (user_question, ruleset, candidate_rules, selected_rule, ai_answer, user_comment, feedback_type) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [question, ruleSet, JSON.stringify(candidates), selected, answer, JSON.stringify(supervisorVerdict), feedback_note]
        );
        console.log(`Interaction logged for attempt #${attempt}.`);
    } catch (e) {
        console.error("Logging failed (non-fatal):", e);
    } finally {
        client.release();
    }
}

async function getSupervisorVerdict(question, ruleText) {
    const endpoint = process.env.SUPERVISOR_ENDPOINT_URL;
    if (!endpoint) {
        console.warn("SUPERVISOR_ENDPOINT_URL not set. Skipping self-correction check.");
        return { is_likely_correct: true, reason: "Supervisor not configured" };
    }
    try {
        const response = await fetch(`${endpoint}/predict`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question: question, rule: ruleText })
        });
        if (!response.ok) {
            console.error(`Supervisor API returned an error: ${response.status} ${response.statusText}`);
            return { is_likely_correct: true, reason: `API Error: ${response.status}` };
        }
        return await response.json();
    } catch (error) {
        console.error("Failed to call Supervisor service:", error);
        return { is_likely_correct: true, reason: "Service Unreachable" };
    }
}

// === MAIN HANDLER ===
export async function handler(event) {
    console.log('--- ask-gemini HANDLER STARTED ---');
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const { question, ruleSet } = JSON.parse(event.body);
        console.log(`--- NEW QUERY: ${question} (${ruleSet}) ---`);

        // --- Step 1: Initial Retrieval (RAG) ---
        const embeddingResponse = await embeddingModel.embedContent({ content: { parts: [{ text: question }] } });
        const queryEmbedding = embeddingResponse.embedding.values;

        const { rows } = await pool.query(`SELECT id, content, embedding FROM rulebooks WHERE ruleset = $1`, [ruleSet]);
        const matches = rows.map(row => ({
            id: row.id,
            content: row.content,
            score: cosineSimilarity(queryEmbedding, JSON.parse(row.embedding))
        }));
        let topCandidates = matches.sort((a, b) => b.score - a.score).slice(0, 5);

        if (topCandidates.length === 0) {
            return { statusCode: 200, body: JSON.stringify({ answer: "I'm sorry, I couldn't find any relevant rules for that question. Please try rephrasing it." }) };
        }

        // --- Step 2: Reasoning & Supervision Loop ---
        const MAX_ATTEMPTS = 2; // Initial Attempt + 1 Retry
        let finalAnswer = "";
        let supervisorApproved = false;

        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            console.log(`\n--- Attempt #${attempt} ---`);
            if (topCandidates.length === 0) {
                console.warn("Ran out of candidate rules to try.");
                break;
            }

            const singleCallPrompt = createFinalPrompt(question, ruleSet, topCandidates);
            const result = await reasoningModel.generateContent(singleCallPrompt);
            const draftAnswer = result.response.text();
            
            const ruleTextForSupervisor = draftAnswer.includes("**Official Rulebook Text:**") 
                ? draftAnswer.split("**Official Rulebook Text:**")[1].trim()
                : topCandidates[0].content;
            
            console.log("Asking Supervisor for a second opinion...");
            const supervisorVerdict = await getSupervisorVerdict(question, ruleTextForSupervisor);
            console.log(`Supervisor Verdict (Attempt ${attempt}):`, supervisorVerdict);

            if (supervisorVerdict.is_likely_correct) {
                console.log(`Supervisor approved answer on attempt #${attempt}.`);
                finalAnswer = draftAnswer;
                supervisorApproved = true;
                await logInteraction(attempt, question, ruleSet, topCandidates, ruleTextForSupervisor, finalAnswer, supervisorVerdict);
                break;
            } else {
                console.warn(`SUPERVISOR REJECTED answer on attempt #${attempt}.`);
                await logInteraction(attempt, question, ruleSet, topCandidates, ruleTextForSupervisor, draftAnswer, supervisorVerdict);
                const failedRuleId = topCandidates.find(c => ruleTextForSupervisor.includes(c.content))?.id;
                topCandidates = topCandidates.filter(c => c.id !== failedRuleId);
            }
        }

        // --- Step 3: Final Response ---
        if (supervisorApproved) {
            return { statusCode: 200, body: JSON.stringify({ answer: finalAnswer }) };
        } else {
            console.error("All attempts failed supervisor validation. Sending fallback.");
            const fallbackAnswer = "I have identified a potential inconsistency in my reasoning for that specific question and have flagged it for review. Could you please try rephrasing your question?";
            return { statusCode: 200, body: JSON.stringify({ answer: fallbackAnswer }) };
        }

    } catch (error) {
        console.error("ERROR in ask-gemini.js:", error);
        // This is your specific error handling logic, now correctly placed.
        if (error.status === 429) {
            return {
                statusCode: 429,
                body: JSON.stringify({ error: "Too many requests. Please wait a moment and try again." })
            };
        }
        return { 
            statusCode: 500, 
            body: JSON.stringify({ error: "Sorry, an internal error occurred. The AI failed to generate a response." }) 
        };
    }
}

// --- Helper to build the final prompt ---
function createFinalPrompt(question, ruleSet, candidates) {
    const systemPersona = prompts[ruleSet] || prompts.default;
    return `
        ${systemPersona}

        **INTERNAL REASONING PROCESS (DO NOT SHOW THIS TO THE USER):**
        1.  **Situational Analysis:** Analyze the user's question: "${question}"
        2.  **Adjudication:** Review the following candidate rules and select the single most relevant one.
            CANDIDATE RULES:
            ${candidates.map((r, i) => `[CANDIDATE ${i+1}]:\n${r.content}`).join("\n\n")}
        3.  **Answer Formulation:** Using ONLY the single rule you selected, formulate a final answer.
        
        ---
        **FINAL OUTPUT TO USER:**
        Your entire output must STRICTLY follow the two-part response structure below. Do not include your internal reasoning steps.

        **Response Structure:**
        **Part 1: The Explanation**
        Provide a clear, conversational, and authoritative answer. Use **bold text** for key terms.
        
        **Part 2: The Rulebook Quotation**
        Provide a section titled "**Official Rulebook Text:**". Quote word-for-word the single rule you selected. Always use proper citation for which rule you quoted.
    `;
}