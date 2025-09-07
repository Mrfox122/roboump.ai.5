// === ask-gemini.js (Enhanced with Automatic Sub-Queries) ===
import { Pool } from "pg";
import { GoogleGenerativeAI } from "@google/generative-ai";
import prompts from "./prompts.js";

const pool = new Pool({ connectionString: process.env.NETLIFY_DATABASE_URL });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const embeddingModel = genAI.getGenerativeModel({ model: "embedding-001" });
const generativeModel = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

// === COSINE SIMILARITY ===
function cosineSimilarity(vecA, vecB) {
  const dot = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
  const magA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
  const magB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
  return dot / (magA * magB);
}

// === STEP 1: ASK GEMINI TO CREATE SUB-QUERIES ===
async function generateSubQueries(question, ruleSet) {
  const subQueryPrompt = `
You are an expert baseball rules analyst.

The user has asked: "${question}"
These rules come from the ${ruleSet} rulebook.

If answering this question requires **multiple rule checks**, break the question into the **smallest possible sub-queries**.
Otherwise, just return one sub-query: the original question.

Return ONLY a JSON array of sub-queries.

Examples:
Q: "Can a pitcher fake a throw to third, then throw to first?"
A: ["pitcher fake throw to third legality", "throw to first after fake legality"]

Q: "What is a balk?"
A: ["definition of a balk"]

Q: "Runner on second, pitcher steps to third and throws to a fielder off-base — legal?"
A: ["pitcher step toward third base legality", "throw to fielder off base legality"]
`;

  const result = await generativeModel.generateContent(subQueryPrompt);
  const text = await result.response.text();
  try {
    return JSON.parse(text);
  } catch {
    console.warn("Sub-query parse failed, using original question.");
    return [question];
  }
}

// === STEP 2: FETCH RELEVANT RULES FOR EACH SUB-QUERY ===
async function fetchRelevantRulesForQuery(query, ruleSet) {
  // Generate embedding for this sub-query
  const embeddingResponse = await embeddingModel.embedContent({
    content: { parts: [{ text: query }] }
  });
  const queryEmbedding = embeddingResponse.embedding.values;

  // Pull rules for this ruleSet
  const { rows } = await pool.query(
    `SELECT id, content, ruleset, embedding
     FROM rulebooks
     WHERE ruleset = $1`,
    [ruleSet]
  );

  const matches = rows.map(row => ({
    ...row,
    embedding: typeof row.embedding === "string" ? JSON.parse(row.embedding) : row.embedding
  }));

  // Score matches by similarity
  matches.forEach(row => {
    row.score = cosineSimilarity(queryEmbedding, row.embedding);
  });

  return matches
    .filter(m => m.score > 0.65)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5); // top 5 per sub-query
}

// === MAIN HANDLER ===
export async function handler(event) {
  try {
    const { question, ruleSet } = JSON.parse(event.body);
    console.log("=== Incoming Question ===", question);
    console.log("Using Rule Set:", ruleSet);

    // === STEP 3: GET SUB-QUERIES FROM GEMINI ===
    const subQueries = await generateSubQueries(question, ruleSet);
    console.log("Generated Sub-Queries:", subQueries);

    // === STEP 4: FETCH RELEVANT RULES FOR ALL SUB-QUERIES ===
    let allMatches = [];
    for (const subQuery of subQueries) {
      const matches = await fetchRelevantRulesForQuery(subQuery, ruleSet);
      allMatches = allMatches.concat(matches);
    }

    // Deduplicate by rule ID
    const uniqueMatches = Array.from(new Map(allMatches.map(m => [m.id, m])).values());

    console.log("Total Relevant Rules:", uniqueMatches.length);

    if (uniqueMatches.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          answer: `I couldn't find a rule in the ${ruleSet} documents that matches your question. Please try rephrasing it.`
        })
      };
    }

    // === STEP 5: BUILD FINAL CONTEXT ===
    const finalContext = uniqueMatches
      .map((match, i) => `Result ${i + 1} (Score: ${match.score.toFixed(4)}):\n${match.content}`)
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
2. Identify if the answer requires more than one rule to explain.
3. Decide which snippets are directly relevant to answering the user's question.
4. Synthesize the relevant information into a clear, conversational answer.
5. Multiple snippets from one rule should be merged, while multiple snippets from different rules need explicit cross-rule reasoning.
6. Always quote the single most relevant rule verbatim
7. Quote a second rule as necessary, especially if cross rule reasoning is used.
8. Do not quote rules inside the explanation


**Response Structure:**
Your response must have **two distinct parts**:

**Part 1: The Explanation**
Provide a clear, conversational, and authoritative answer to the user's question.
Use **bold text** for key terms.
Reference multiple rules **only if necessary** and explain how they interact.
Integrate the glossary definitions naturally.

**Part 2: The Rulebook Quotation**
Provide a section titled "**Official Rulebook Text:**"
Always quote word-for-word the **single most relevant rule**.
If a second rule was used, include it as "**Additional Relevant Rule**" below the first.
Do not combine it with your explanation.

---
CONTEXT FROM RULEBOOK:
${finalContext}
---

USER'S QUESTION (Answer according to ${ruleSet} rules):
${question}`;

    // === STEP 7: SEND TO GEMINI ===
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



