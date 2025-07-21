// netlify/functions/run-indexer.js (With advanced cleaning)
const { Pinecone } = require("@pinecone-database/pinecone");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require("fs").promises;
const path = require("path");

const filesToIndex = [
    { path: './rulebooks/2025-NCAA.txt', ruleSet: ['NCAA'] },
    { path: './rulebooks/2025-CCA.txt',  ruleSet: ['CCA'] }, 
];

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

async function indexFile(filePath, ruleSetArray) {
    console.log(`Processing ${filePath}...`);
    const absolutePath = path.resolve(__dirname, `../../${filePath}`);
    const text = await fs.readFile(absolutePath, 'utf-8');

    // --- NEW, ADVANCED CLEANING ---
    const cleanedText = text
        // Remove page headers/footers like "123 CCA Baseball Umpires Manual"
        .replace(/(\d+ CCA Baseball Umpires Manual)/g, '')
        // Remove lines that are just numbers (page numbers)
        .replace(/^\s*\d+\s*$/gm, '')
        // Join lines that were broken in the middle of a sentence
        .replace(/-\r?\n/g, '')
        // Replace multiple newlines/spaces with a single space
        .replace(/\s+/g, ' ')
        .trim();
    // --- END OF CLEANING ---

    const textChunks = chunkText(cleanedText);
    console.log(`Split into ${textChunks.length} chunks.`);

    const batchSize = 50;
    for (let i = 0; i < textChunks.length; i += batchSize) {
        let batch = textChunks.slice(i, i + batchSize);
        let nonEmptyBatch = batch.filter(chunk => chunk && chunk.trim().length > 10);
        if (nonEmptyBatch.length === 0) continue;

        const result = await embeddingModel.batchEmbedContents({
            requests: nonEmptyBatch.map(chunk => ({
                content: { parts: [{ text: chunk }] },
                taskType: "RETRIEVAL_DOCUMENT"
            }))
        });

        const vectors = result.embeddings.map((embedding, j) => ({
            id: `${path.basename(filePath)}-${i + j}`,
            values: embedding.values,
            metadata: { text: nonEmptyBatch[j], ruleSet: ruleSetArray }
        }));

        await pineconeIndex.upsert(vectors);
        console.log(`Successfully indexed batch of ${vectors.length} vectors for ${filePath}.`);
    }
}

exports.handler = async function (event) {
    if (event.headers['x-secret-key'] !== '1234') {
        return { statusCode: 401, body: 'Unauthorized' };
    }
    try {
        console.log("Starting indexing process...");
        await pineconeIndex.deleteAll();
        console.log("Cleared old data from Pinecone index.");

        for (const file of filesToIndex) {
            await indexFile(file.path, file.ruleSet);
        }

        return {
            statusCode: 200,
            body: "Indexing complete for all files!",
        };
    } catch (error) {
        console.error("Indexing failed:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message }),
        };
    }
};