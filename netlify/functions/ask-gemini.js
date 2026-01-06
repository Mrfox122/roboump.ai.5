import { Pool } from "pg";
import { GoogleGenerativeAI } from "@google/generative-ai";
import prompts from "./prompts.js";

const pool = new Pool({ connectionString: process.env.NETLIFY_DATABASE_URL });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const embeddingModel = genAI.getGenerativeModel({ model: "embedding-001" });
// Using Flash for logic/analysis because it's fast and smart
const reasoningModel = genAI.getGenerativeModel({ model: "gemini-2.0-flash" }); 

// === HELPER: COSINE SIMILARITY ===
function cosineSimilarity(vecA, vecB) {
  const dot = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
  const magA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
  const magB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
  return dot / (magA * magB);
}

// === COMPONENT 2.2: THE SITUATIONAL ANALYST ===
async function analyzeSituation(question) {
  const analysisPrompt = `
    You are an expert Baseball Official Scorer.
    Analyze this user question: "${question}"
    
    Extract the game situation into a JSON object.
    If a detail is missing, use "null".
    
    Output Format (JSON ONLY):
    {
      "outs": integer or null,
      "runners": ["1B", "2B", "3B"] or [],
      "batter_action": string or null (e.g., "bunt", "fly ball", "hit by pitch"),
      "defense_action": string or null (e.g., "obstruction", "tag", "appeal"),
      "key_terms": [string] (list of 3-5 specific search keywords found in the rulebook)
    }
  `;

  try {
    const result = await reasoningModel.generateContent(analysisPrompt);
    const text = result.response.text();
    const jsonStr = text.replace(/```json/g, "").replace(/```/g, "").trim();
    return JSON.parse(jsonStr);
  } catch (e) {
    console.error("Situational Analysis Failed:", e);
    return { key_terms: [question] }; // Fallback
  }
}

// === COMPONENT 2.3: THE RULES COMMITTEE (ADJUDICATION) ===
async function adjudicateRules(situation, candidateRules) {
  if (candidateRules.length === 0) return "No specific rule found.";

  const adjudicationPrompt = `
    You are the Crew Chief Umpire.
    
    THE SITUATION:
    ${JSON.stringify(situation, null, 2)}
    
    THE CANDIDATE RULES (from database):
    ${candidateRules.map((r, i) => `[Rule #${i+1}]: ${r.content}`).join("\n\n")}
    
    TASK:
    1. Analyze which rule best applies to the specific Situation.
    2. Discard rules that share keywords but apply to different situations.
    3. Return the text of the most relevant rules.
    
    Output ONLY the relevant rule text.
  `;

  const result = await reasoningModel.generateContent(adjudicationPrompt);
  return result.response.text();
}

// === Data Collection ===

async function logInteraction(client, question, ruleSet, situation, topCandidates, finalRule, answer) {
    try {
        await client.query(
            `INSERT INTO query_logs 
            (user_question, ruleset, situation_analysis, candidate_rules, selected_rule, ai_answer) 
            VALUES ($1, $2, $3, $4, $5, $6)`,
            [
                question, 
                ruleSet, 
                JSON.stringify(situation), 
                JSON.stringify(topCandidates), 
                finalRule, 
                answer
            ]
        );
        console.log("Logged interaction to DB.");
    } catch (e) {
        console.error("Logging failed (non-fatal):", e);
    }
}


// === MAIN HANDLER ===
export async function handler(event) {
  try {
    const { question, ruleSet, token } = JSON.parse(event.body);
    
    console.log(`\n--- NEW QUERY: ${question} (${ruleSet}) ---`);

    // === STEP 1: SITUATIONAL ANALYSIS ===
    const situation = await analyzeSituation(question);
    console.log("Situation:", JSON.stringify(situation));

    // === STEP 2: RETRIEVAL (RAG) ===
    // Search using extracted keywords + original question
    const searchQuery = `${question} ${situation.key_terms ? situation.key_terms.join(" ") : ""}`;
    
    const embeddingResponse = await embeddingModel.embedContent({
      content: { parts: [{ text: searchQuery }] }
    });
    const queryEmbedding = embeddingResponse.embedding.values;

    const { rows } = await pool.query(
      `SELECT id, content, ruleset, embedding FROM rulebooks WHERE ruleset = $1`,
      [ruleSet]
    );

    const matches = rows.map(row => ({
      ...row,
      embedding: JSON.parse(row.embedding),
      score: 0
    }));

    matches.forEach(row => {
      row.score = cosineSimilarity(queryEmbedding, row.embedding);
    });

    // Get Top Candidates for Adjudication
    const topCandidates = matches
      .sort((a, b) => b.score - a.score)
      .slice(0, 6) // Grab top 6 to give the Committee options
      .filter(m => m.score > 0.55);

    // === STEP 3: ADJUDICATION (The Rules Committee) ===
    let finalRuleContext = "";
    if (topCandidates.length > 0) {
        console.log(`Adjudicating ${topCandidates.length} rules...`);
        finalRuleContext = await adjudicateRules(situation, topCandidates);
    } else {
        finalRuleContext = "No specific rule text found in the library matching this query.";
    }

    // === STEP 4: FINAL RESPONSE GENERATION ===
    // Here we inject your specific structure requirements
    
    const selectedPrompt = prompts[ruleSet] || prompts.default;

    const finalPrompt = `${selectedPrompt}

**Instructions:**
1. Review ALL the provided text snippets (The Adjudicated Rules).
2. Read that rule to see if an exception or a cross-referenced rule applies.
3. Identify if the answer requires more than one rule to explain.
4. Decide which snippets are directly relevant to answering the user's question.
5. Synthesize the relevant information into a clear, conversational answer.
6. Multiple snippets from one rule should be merged, while multiple snippets from different rules need explicit cross-rule reasoning.
7. Always quote the single most relevant rule verbatim
8. Quote a second rule as necessary, especially if cross rule reasoning is used.
9. Do not quote rules inside the explanation

**Response Structure:**
Your response must have **two distinct parts**:

**Part 1: The Explanation**
Provide a clear, conversational, and authoritative answer to the user's question.
Use **bold text** for key terms.
Reference multiple rules **as necessary** and explain how they interact.
Integrate the glossary definitions naturally.
Don't be afraid to include additional rules or subsections of the rule if it seems relevant.

**Part 2: The Rulebook Quotation**
Provide a section titled "**Official Rulebook Text:**"
Analyze if more than one rule or multiple parts of the rule were used.
Always quote word-for-word the **single most relevant rule**.
If a second rule was used, include it as "**Additional Relevant Rule**" below the first.
Do not combine it with your explanation.
Use proper citation for rules, example: 6.01(g) opposed to (g)

---
**SITUATION ANALYSIS (Internal Logic):**
${JSON.stringify(situation)}

**ADJUDICATED RULE CONTEXT (Evidence):**
${finalRuleContext}
---

**USER'S QUESTION (Answer according to ${ruleSet} rules):**
${question}`;

    const response = await reasoningModel.generateContent(finalPrompt);
    const aiAnswer = response.response.text();
    const client = await pool.connect();
try {
    await logInteraction(client, question, ruleSet, situation, topCandidates, finalRuleContext, aiAnswer);
} finally {
    client.release();
}

    return {
      statusCode: 200,
      body: JSON.stringify({ answer: aiAnswer })
    };

  } catch (error) {
    console.error("Error:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Internal Server Error" })
    };
  }
}