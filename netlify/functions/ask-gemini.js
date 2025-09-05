// --- ask-gemini.js (Netlify Function) ---
// This is the main serverless function responsible for:
// 1. Verifying that a real user is asking the question (via reCAPTCHA)
// 2. Analyzing the question and generating smart search terms
// 3. Searching Pinecone for relevant rulebook snippets based on AI-generated queries
// 4. Asking Gemini to generate a full response using the retrieved context
// 5. Returning the AI-generated answer to the frontend

// --- Required Dependencies ---
const { Pinecone } = require("@pinecone-database/pinecone");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const fetch = require("node-fetch");


// --- Initialize Pinecone and Gemini Clients ---
const pinecone = new Pinecone(); 
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const pineconeIndex = pinecone.index("umpire-rules");
const embeddingModel = genAI.getGenerativeModel({ model: "embedding-001" });
const generativeModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// --- Persona Templates (custom AI instructions per ruleset) ---
const prompts = {
     'NCAA': `You are the "NCAA Rules and Umpire Mechanics Digital Assistant." Your identity is that of an expert college baseball umpire instructor and rules interpreter. Your entire knowledge base is built upon the official 2025 CCA College Umpire Mechanics book and the corresponding NCAA Baseball rulebook. You are precise, authoritative, and dedicated to helping umpires improve their craft.

Core Directives:

1. **Knowledge Source**: Your single source of truth is your pre-trained knowledge of the 2025 CCA College Umpire Mechanics book and the official 2025 NCAA Baseball Rules.

2. **Scope of Expertise**: Answer questions regarding NCAA rules, including Two-Umpire, Three-Umpire, and Four-Umpire system mechanics, positioning, responsibilities, and rule interpretations.

3. **Response Style**: Provide direct, clear answers with an authoritative tone. Use **bold text** for key terms. Use numbered or bulleted lists for procedures.

4. **Rules Interpretation**: All of your rules will cite the proper rule in the Rulebook format (e.g., Rule 1-2).

5. You will know the difference between all parts of Rule 2-35 (FOUL BALL).

6. You will know all the differences in Rule 8-2 (BATTER BECOMES BASE RUNNER).

7. You will know all base entitlements under Rule 8-3 (ENTITLED TO BASES).

8. You are an expert on **balks**. For any pitching-related question, provide answers for both **Set/Stretch** and **Windup** positions.

Note: When citing rules, always follow the official NCAA rulebook structure. Respond authoritatively and concisely, like an umpire instructor during a clinic.`,

    'NFHS': `You are an expert on the NFHS (National Federation of State High School Associations) baseball rulebook and umpire mechanics. Your identity is that of a seasoned high school umpire instructor. You provide clear, concise answers based strictly on NFHS rules for high school baseball and all Umpire Mechanics Questions will use the 2025 CCA Umpires Manual.

    Core Directives:
    1. Knowledge Source: Your expertise is based on the official NFHS baseball rulebook and casebook as well.
    2. Scope of Expertise: Answer questions specifically for high school baseball rules and umpire mechanics.
    3. Response Style: Use clear, easy-to-understand language suitable for umpires at the high school level. Use bold text for key terms and lists for complex situations.
    4. Rules Interpretation: All of your rules will cite the proper rule in the Rulebook format i.e. Rule 1-2`,

    'MLB': `You are an expert on the Official Baseball Rules (OBR) used in Major League Baseball. Your persona is that of a professional umpire analyst. Your answers are precise and based on the Official Baseball Rules and all Umpire Mechanics Questions will use the 2025 CCA Umpires Manual.

    Core Directives:
    1. Knowledge Source: Your knowledge is based on the Official Baseball Rules (OBR) that govern professional baseball.
    2. Scope of Expertise: Answer questions strictly according to professional baseball rules and established interpretations.
    3. Response Style: Provide detailed, professional-level answers. Use bold text for key terms and cite rule numbers where applicable.
    4. Rules Interpretation: All of your rules will cite the proper rule in the Rulebook format i.e. Rule 1-2`,
    
    'default': `You are a helpful baseball rules assistant.` 

};
// --- Main Lambda Handler ---

exports.handler = async function (event) {
    const { question, ruleSet, token } = JSON.parse(event.body);

    try {

// === STEP 1: VERIFY USER (reCAPTCHA Check) ===
        // Prevents spam and abuse by ensuring the request is human-generated
        const recaptchaResponse = await fetch(`https://www.google.com/recaptcha/api/siteverify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `secret=${process.env.RECAPTCHA_SECRET_KEY}&response=${token}`
        });
        
        const recaptchaData = await recaptchaResponse.json();

        // Check if the user is likely human
        if (!recaptchaData.success || recaptchaData.score < 0.5) {
            console.log("reCAPTCHA verification failed:", recaptchaData['error-codes']);
            return {
                statusCode: 400,
                body: JSON.stringify({ answer: 'reCAPTCHA verification failed. You might be a bot!' })
            };
        }
        // --- END reCAPTCHA VERIFICATION ---
// === STEP 2: INTERPRET SLANG & REPHRASE QUESTION ===
const glossaryQuery = await pineconeIndex.query({
    vector: (await embeddingModel.embedContent({ content: { parts: [{ text: "baseball slang terms" }] } })).embedding.values,
    topK: 150,
    includeMetadata: true,
    filter: { "ruleSet": { "$in": ["Glossary"] } }
});
const glossaryContext = glossaryQuery.matches.map(match => match.metadata.text).join("\n\n");

const analysisPrompt = `You are a baseball language expert. Analyze the user's question using the provided glossary of slang terms. Your task is to identify any slang and rephrase the question into clear, official terminology.

Respond in a strict JSON format with two keys: "slang_definition" and "rephrased_question".
- If slang is found, provide its definition from the glossary.
- If no slang is found, the value for "slang_definition" must be "None".

GLOSSARY:
${glossaryContext}
---
USER'S QUESTION: "${question}"`;
        
const analysisResult = await generativeModel.generateContent(analysisPrompt);
const analysisText = (await analysisResult.response).text();
const analysis = JSON.parse(analysisText.replace(/```json\n?|\n?```/g, ''));

console.log("AI Slang Analysis:", analysis);
const { slang_definition, rephrased_question } = analysis;
const glossaryMatches = glossaryQuery.matches || [];
const glossaryDefinitions = glossaryMatches
    .map(match => `• ${match.metadata.term || "Term"}: ${match.metadata.text}`)
    .join("\n") || null;


// === STEP 3: GENERATE MULTIPLE SEARCH QUERIES FROM THE CLEAN QUESTION ===
const multiQueryPrompt = `You are a baseball rules expert. Analyze the user's question and generate 3 diverse search queries to find the most relevant rule in our baseball rulebook. Think about keywords, official terminology, and the likely section the rule would be in. Keep in mind base awards, definitions and unusual situations.
Rephrased Question: "${rephrased_question}"

Respond with only the 3 queries, each on a new line.`;

const multiQueryResult = await generativeModel.generateContent(multiQueryPrompt);
const searchQueries = (await multiQueryResult.response).text().split('\n').map(q => q.trim()).filter(q => q.length > 0);
searchQueries.unshift(rephrased_question); // Also search for the main rephrased question

console.log(`AI identified search terms for ${ruleSet}:`, searchQueries);

         // === STEP 4: EMBEDDING + VECTOR SEARCH (via Pinecone) ===
        // Convert each query into vector embeddings
        const embeddingRequests = searchQueries.map(q => ({
  content: { parts: [{ text: q }] },
  taskType: "RETRIEVAL_QUERY"
}));

const embeddingResult = await embeddingModel.batchEmbedContents({ requests: embeddingRequests });
const queryVectors = embeddingResult.embeddings.map(e => e.values);

// Search Pinecone for each embedded query vector
const searchPromises = queryVectors.map(vector => 
  pineconeIndex.query({
    vector,
    topK: 10,
    includeMetadata: true,
    filter: { ruleSet: { "$in": [ruleSet] } }
  })
);
const searchResponses = await Promise.all(searchPromises);

// === STEP 5: MERGE & FILTER RESULTS ===
// Combine results from all searches, remove duplicates, and apply similarity threshold
const allMatches = searchResponses.flatMap(res => res.matches);
const uniqueMatches = Array.from(new Map(allMatches.map(m => [m.id, m])).values());

const SIMILARITY_THRESHOLD = 0.65;

// Filter only relevant matches
const relevantMatches = uniqueMatches
    .filter(match => match.score > SIMILARITY_THRESHOLD)
    .sort((a, b) => b.score - a.score); // Sort descending by score

const topMatch = relevantMatches[0] || null;

// Log debugging info
console.log("DEBUG: Raw Pinecone responses:", JSON.stringify(searchResponses, null, 2));
console.log("DEBUG: Relevant matches found:", relevantMatches.length);

if (relevantMatches.length > 0) {
    console.log("DEBUG: Top match score:", relevantMatches[0].score);
    console.log("DEBUG: Top match metadata snippet:", relevantMatches[0].metadata.text?.slice(0, 200));
} else {
    console.log("DEBUG: No relevant matches found above similarity threshold.");
}

// If no good matches were found, notify user early
if (relevantMatches.length === 0) {
    return {
        statusCode: 200,
        body: JSON.stringify({
            answer: `I couldn't find a rule in the ${ruleSet} documents that was a close enough match to answer that question. Please try rephrasing it.`,
        }),
    };
}

// Build the full context block from all relevant matches
const finalContext = relevantMatches
    .map((match, i) => `Result ${i + 1} (Score: ${match.score.toFixed(4)}):\n${match.metadata.text}`)
    .join("\n\n---\n\n");

console.log("Retrieved Context:\n", finalContext);


        // === STEP 6: FINAL ANSWER GENERATION (Gemini) ===
        // Construct the final prompt with persona + rules + question + rulebook context
        const selectedPrompt = prompts[ruleSet] || prompts.default;

//Logging for debugging

console.log("=== DEBUG LOG ===");
console.log("User Question:", question);
console.log("Search Term:", searchQueries[0]);
console.log("Ruleset:", ruleSet);
console.log("Top Match Score:", topMatch.score.toFixed(4));
console.log("Top Match Text (preview):", topMatch.metadata.text.slice(0, 200) + '...');
console.log("=================");       
 
        const finalPrompt = `${selectedPrompt}

        **Your Task:**
        You will be given a user's question and a collection of text snippets from a rulebook.

        **Glossary Definitions (Authoritative):**
        ${glossaryDefinitions || "None detected."}

    **Instructions:**
    1. Review ALL the provided text snippets below.
    2. Decide which snippets are directly relevant to answering the user's question.
    3. Synthesize the relevant information into a clear, conversational answer.
    4. If multiple snippets are relevant, combine them intelligently.
    5. At the end, quote the **single most relevant** rule verbatim.

        **Response Structure:**
        Your response must have two distinct parts:
        
        **Part 1: The Explanation**
        First, provide a clear, conversational, and authoritative answer to the user's question. Synthesize the information from the context into an easy-to-understand explanation. Use bold text for key terms.

        **Part 2: The Rulebook Quotation**
        Second, add a section titled "**Official Rulebook Text:**". Below this title, provide a direct, word-for-word quotation of the single most relevant rule or section from the "CONTEXT FROM RULEBOOK" that supports your answer.

        ---
        CONTEXT FROM RULEBOOK:
        ${finalContext}
        ---
        
        USER'S QUESTION (Answer according to ${ruleSet} rules):
        ${question}`;


         // Send to Gemini and retrieve AI-generated response
const generationResult = await generativeModel.generateContent(finalPrompt);
const aiAnswer = await generationResult.response.text();

     // Debug log
console.log("=== FINAL PROMPT SENT TO GEMINI ===");
console.log(finalPrompt);
console.log("===================================");
console.log("=== AI FINAL RESPONSE ===");
console.log(aiAnswer);
console.log("=========================");

// === STEP 7: Return Final Answer ===
        return {
            statusCode: 200,
            body: JSON.stringify({ answer: aiAnswer }),
        };




    } catch (error) {
        console.error("Full error:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message }),
        };
    }
};
