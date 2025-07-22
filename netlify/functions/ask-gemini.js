

// netlify/functions/ask-gemini.js (With Threshold and Logging)
const { Pinecone } = require("@pinecone-database/pinecone");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const pinecone = new Pinecone(); 
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const pineconeIndex = pinecone.index("umpire-rules");
const embeddingModel = genAI.getGenerativeModel({ model: "embedding-001" });
const generativeModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

exports.handler = async function (event) {
    const { question } = JSON.parse(event.body);

    try {
        const questionEmbedding = await embeddingModel.embedContent({
            content: { parts: [{ text: question }] },
            taskType: "RETRIEVAL_QUERY"
        });

        const queryResponse = await pineconeIndex.query({
            vector: questionEmbedding.embedding.values,
            topK: 10,
        });

        // --- IMPROVEMENT 1: SIMILARITY THRESHOLD ---
        // Filter out results that are not highly relevant (score < 0.75)
        const SIMILARITY_THRESHOLD = 0.75;
        const relevantMatches = queryResponse.matches.filter(match => match.score > SIMILARITY_THRESHOLD);

//friends code
console.log("📊 SIMILARITY SCORES & MATCHED TEXT PREVIEWS:");
if (relevantMatches.length === 0) {
  console.log("⚠️ No matches passed the similarity threshold.");
} else {
  relevantMatches.forEach((match, index) => {
    console.log(`--- Match ${index + 1} ---`);
    console.log(`Score: ${match.score}`);
    console.log(`Preview: ${match.metadata?.text?.slice(0, 300)}\n`);
  });
}



        if (relevantMatches.length === 0) {
            return {
                statusCode: 200,
                body: JSON.stringify({ answer: "I couldn't find a rule in the documents that was a close enough match to answer that question. Please try rephrasing it." }),
            };
        }
        
        const context = relevantMatches.map(match => match.metadata.text).join("\n\n---\n\n");

        // --- IMPROVEMENT 2: DEBUGGING/LOGGING ---
        // This will print the context to your Netlify function logs
        console.log("Retrieved Context:\n", context);

        const prompt = `You are the "NCAA Rules and Umpire Mechanics Digital Assistant." Your identity is that of an expert college baseball umpire instructor and rules interpreter. Your entire knowledge base is built upon the official 2025 CCA College Umpire Mechanics book and the corresponding NCAA Baseball rulebook. You are precise, authoritative, and dedicated to helping umpires improve their craft.

        Core Directives:
        1.  **Knowledge Source**: Your single source of truth is the content provided below in the "CONTEXT FROM RULEBOOK" section. Do not use any outside knowledge.
        2.  **Scope of Expertise**: Answer questions about umpiring mechanics (2-man, 3-man, 4-man), positioning, responsibilities, rule interpretations, and procedures based ONLY on the provided context.
        3.  **Response Style**:
            * **Clarity and Conciseness**: Provide direct, clear answers.
            * **Authoritative Tone**: Respond with confidence.
            * **Formatting**: Use **bold text** for key terms. Use numbered or bulleted lists for procedures and responsibilities.
            * **Citing the Source**: Frame your response as if referencing a manual, e.g., "According to the CCA mechanics manual..."
        4.  **Handling Ambiguity**: If the user's question is ambiguous and the context doesn't provide enough information, ask for clarifying details (e.g., "To give you the correct mechanic, could you please tell me the umpire system and where the runners are?").
        5.  **Admit Limitations**: If the provided context does not contain the information needed to answer the question, state it clearly. A safe response is: A safe response is: "My knowledge is based on the 2025 CCA Umpire Mechanics book and the 2025 NCAA Rule Book; the provided text does not contain information on that specific scenario." Do not guess

        ---
        CONTEXT FROM RULEBOOK:
        ${context}
        ---
        
        USER'S QUESTION:
        ${question}`;

        const result = await generativeModel.generateContent(prompt);
        const response = await result.response;
        const aiAnswer = response.text();

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