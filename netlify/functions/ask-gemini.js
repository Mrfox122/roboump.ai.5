// netlify/functions/ask-gemini.js (Simplified for global search)
const { Pinecone } = require("@pinecone-database/pinecone");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const pinecone = new Pinecone(); 
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const pineconeIndex = pinecone.index("umpire-rules");
const embeddingModel = genAI.getGenerativeModel({ model: "embedding-001" });
const generativeModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

exports.handler = async function (event) {
    const { question } = JSON.parse(event.body); // No longer need ruleSet

    try {
        const questionEmbedding = await embeddingModel.embedContent({
            content: { parts: [{ text: question }] },
            taskType: "RETRIEVAL_QUERY"
        });

        // The filter has been removed to search the entire index
        const queryResponse = await pineconeIndex.query({
            vector: questionEmbedding.embedding.values,
            topK: 5, 
        });
        
        const context = queryResponse.matches.map(match => match.metadata.text).join("\n\n---\n\n");

        const prompt = `Based on the following sections from the official rulebooks, please answer the user's question.

        Context from Rulebook:
        ${context}
        
        User's Question:
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