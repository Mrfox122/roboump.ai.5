


// index-files.js (Final Corrected Version)
const { Pinecone } = require("@pinecone-database/pinecone");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require("fs");
const path = require("path");

// --- CONFIGURE THIS SECTION ---
const PINECONE_API_KEY = "pcsk_469654_FBzHXBc9RN2nbkPCZYdDo4kbMpUrC95iX7xdXAHCAZPrCp6mvaxnYNY17qVhe9o";
const GOOGLE_API_KEY = "AIzaSyBZltm0VI1pS3Pg5Bbj9H4LWYkoJtXhzYA";

const filesToIndex = [
    { path: './rulebooks/2025-NCAA.txt', ruleSet: 'NCAA' },
    // { path: './rulebooks/2025-CCA.txt', ruleSet: 'NCAA' },
];
// --------------------------------

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const pinecone = new Pinecone({
    apiKey: PINECONE_API_KEY
});

const genAI = new GoogleGenerativeAI(GOOGLE_API_KEY);
const pineconeIndex = pinecone.index("umpire-rules");
const embeddingModel = genAI.getGenerativeModel({ model: "embedding-001" });

const chunkText = (text, chunkSize = 400, overlap = 40) => {
    const chunks = [];
    for (let i = 0; i < text.length; i += chunkSize - overlap) {
        chunks.push(text.substring(i, i + chunkSize));
    }
    return chunks;
};

async function indexFile(filePath, ruleSet) {
    console.log(`Processing ${filePath}...`);
    
    const text = fs.readFileSync(filePath, 'utf-8');
    const cleanedText = text.replace(/\s+/g, ' ');

    const textChunks = chunkText(cleanedText);
    console.log(`Split into ${textChunks.length} chunks.`);

    const batchSize = 50;
    for (let i = 0; i < textChunks.length; i += batchSize) {
        let batch = textChunks.slice(i, i + batchSize);
        let nonEmptyBatch = batch.filter(chunk => chunk && chunk.trim().length > 10);

        if (nonEmptyBatch.length === 0) continue;

        console.log(`Processing batch ${Math.floor(i / batchSize) + 1} of ${Math.ceil(textChunks.length / batchSize)}...`);
        const result = await embeddingModel.batchEmbedContents({
            requests: nonEmptyBatch.map(chunk => ({ content: chunk, taskType: "RETRIEVAL_DOCUMENT" }))
        });

        const vectors = result.embeddings.map((embedding, j) => ({
            id: `${path.basename(filePath)}-${i + j}`,
            values: embedding.values,
            metadata: { text: nonEmptyBatch[j], ruleSet: ruleSet }
        }));
        
        await pineconeIndex.upsert(vectors);
        console.log(`Successfully indexed batch of ${vectors.length} vectors.`);
        await sleep(1000);
    }
}

(async () => {
    try {
        for (const file of filesToIndex) {
            await indexFile(file.path, file.ruleSet);
        }
        console.log("--- Indexing complete! ---");
    } catch (error) {
        console.error("Indexing failed:", error);
    }
})();