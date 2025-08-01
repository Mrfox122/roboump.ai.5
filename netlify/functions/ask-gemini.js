// netlify/functions/ask-gemini.js (Final Hybrid Version with Ruleset Filtering)
const { Pinecone } = require("@pinecone-database/pinecone");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const fetch = require("node-fetch");

const pinecone = new Pinecone(); 
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const pineconeIndex = pinecone.index("umpire-rules");
const embeddingModel = genAI.getGenerativeModel({ model: "embedding-001" });
const generativeModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// --- YOUR CUSTOM EXPERT PERSONAS ---
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
// ------------------------------------

exports.handler = async function (event) {
    const { question, ruleSet, token } = JSON.parse(event.body);

    try {

// --- VERIFY reCAPTCHA TOKEN ---
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

        // --- STEP 1: AI-POWERED QUERY ANALYSIS ---
        const analysisPrompt = `Based on the user's question, generate 3 different search queries that will help find the most relevant baseball rule or mechanic. The queries should be diverse and cover different aspects of the question.
User Question: "${question}"

Respond with only the 3 search queries, each on a new line.`;
        
        const analysisResult = await generativeModel.generateContent(analysisPrompt);
const searchTermsRaw = await analysisResult.response.text();
const searchQueries = searchTermsRaw.split('\n').map(q => q.trim()).filter(q => q.length > 0);
searchQueries.unshift(question);

        console.log(`AI identified search term for ${ruleSet}: "${searchTerm.trim()}"`);

        const embeddingRequests = searchQueries.map(q => ({
  content: { parts: [{ text: q }] },
  taskType: "RETRIEVAL_QUERY"
}));

const embeddingResult = await embeddingModel.batchEmbedContents({ requests: embeddingRequests });
const queryVectors = embeddingResult.embeddings.map(e => e.values);

// 🔁 Query Pinecone for each embedding
const searchPromises = queryVectors.map(vector => 
  pineconeIndex.query({
    vector,
    topK: 5,
    includeMetadata: true,
    filter: { ruleSet: { "$in": [ruleSet] } }
  })
);
const searchResponses = await Promise.all(searchPromises);

// 🧼 Combine, deduplicate, and filter
const allMatches = searchResponses.flatMap(res => res.matches);
const uniqueMatches = Array.from(new Map(allMatches.map(m => [m.id, m])).values());

const SIMILARITY_THRESHOLD = 0.70;
const relevantMatches = uniqueMatches.filter(match => match.score > SIMILARITY_THRESHOLD);

console.log("DEBUG: Raw Pinecone response:", JSON.stringify(queryResponse, null, 2));

        const SIMILARITY_THRESHOLD = 0.66;
        const relevantMatches = queryResponse.matches.filter(match => match.score > SIMILARITY_THRESHOLD);

// comment out debug K value log
if (relevantMatches.length > 0) {
console.log("DEBUG: Top match score:", relevantMatches[0].score);
console.log("DEBUG: Top match metadata snippet:", relevantMatches[0].metadata.text?.slice(0, 200));
} else {
console.log("DEBUG: No relevant matches found above similarity threshold.");
}






        if (relevantMatches.length === 0) {
            return {
                statusCode: 200,
                body: JSON.stringify({ answer: `I couldn't find a rule in the ${ruleSet} documents that was a close enough match to answer that question. Please try rephrasing it.` }),
            };
        }
        const topMatch = relevantMatches[0]; // top scoring result
        const cleanSearchTerm = searchTerm.trim();

if (!cleanSearchTerm || cleanSearchTerm.length < 2) {
  return {
    statusCode: 400,
    body: JSON.stringify({ answer: "I couldn't understand your question clearly. Try asking it differently." }),
  };
}





        const context = relevantMatches.map(match => match.metadata.text).join("\n\n---\n\n");
        console.log("Retrieved Context:\n", context);

        // --- STEP 3: FINAL ANSWER GENERATION ---
        const selectedPrompt = prompts[ruleSet] || prompts.default;

//Logging for debugging

console.log("=== DEBUG LOG ===");
console.log("User Question:", question);
console.log("Search Term:", cleanSearchTerm);
console.log("Ruleset:", ruleSet);
console.log("Top Match Score:", topMatch.score.toFixed(4));
console.log("Top Match Text (preview):", topMatch.metadata.text.slice(0, 200) + '...');
console.log("=================");       
 
        const finalPrompt = `${selectedPrompt}



        **Response Structure:**
        Your response must have two distinct parts:
        
        **Part 1: The Explanation**
        First, provide a clear, conversational, and authoritative answer to the user's question. Synthesize the information from the context into an easy-to-understand explanation. Use bold text for key terms.

        **Part 2: The Rulebook Quotation**
        Second, add a section titled "**Official Rulebook Text:**". Below this title, provide a direct, word-for-word quotation of the single most relevant rule or section from the "CONTEXT FROM RULEBOOK" that supports your answer.

        ---
        CONTEXT FROM RULEBOOK:
        ${context}
        ---
        
        USER'S QUESTION (Answer according to ${ruleSet} rules):
        ${question}`;

const generationResult = await generativeModel.generateContent(finalPrompt);
const aiAnswer = await generationResult.response.text();

console.log("=== FINAL PROMPT SENT TO GEMINI ===");
console.log(finalPrompt);
console.log("===================================");
console.log("=== AI FINAL RESPONSE ===");
console.log(aiAnswer);
console.log("=========================");


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
