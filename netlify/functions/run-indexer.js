// netlify/functions/run-indexer.js
const { Pinecone } = require("@pinecone-database/pinecone");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require("fs").promises;
const path = require("path");

// Initialize clients from environment variables
const pinecone = new Pinecone(); 
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const pineconeIndex = pinecone.index("umpire-rules");
const embeddingModel = genAI.getGenerativeModel({ model: "embedding-001" });

const chunkText = (text, chunkSize = 400, overlap = 40) => {
    const chunks = [];
    for (let i = 0; i < text.length; i += chunkSize - overlap) {
        chunks.push(text.substring(i, i + chunkSize));
    }
    return chunks;
};

exports.handler = async function (event) {
    if (event.headers['x-secret-key'] !== '1234') {
        return { statusCode: 401, body: 'Unauthorized' };
    }

    try {
        console.log("Starting indexing process...");
        
        const filePath = path.resolve(__dirname, '../../rulebooks/2025-NCAA.txt');
        const text = await fs.readFile(filePath, 'utf-8');
        const cleanedText = text.replace(/\s+/g, ' ');
        const textChunks = chunkText(cleanedText);

        console.log(`Split into ${textChunks.length} chunks.`);

        const batchSize = 50;
        for (let i = 0; i < textChunks.length; i += batchSize) {
            let batch = textChunks.slice(i, i + batchSize);
            let nonEmptyBatch = batch.filter(chunk => chunk && chunk.trim().length > 10);
            if (nonEmptyBatch.length === 0) continue;

            // This is the corrected section
            const result = await embeddingModel.batchEmbedContents({
                requests: nonEmptyBatch.map(chunk => ({
                    content: { parts: [{ text: chunk }] }, // Correctly formatted content
                    taskType: "RETRIEVAL_DOCUMENT"
                }))
            });

            const vectors = result.embeddings.map((