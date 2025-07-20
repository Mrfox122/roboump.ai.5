// index-files.js (Final, most robust version)
const { Pinecone } = require("@pinecone-database/pinecone");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require("fs");
const path = require("path");
const pdf = require("pdf-parse");

// --- CONFIGURE THIS SECTION ---
const PINECONE_API_KEY = "pcsk_469654_FBzHXBc9RN2nbkPCZYdDo4kbMpUrC95iX7xdXAHCAZPrCp6mvaxnYNY17qVhe9o";
const GOOGLE_API_KEY = "AIzaSyAHeFneV277metWMzPpN14Wsz5BfPx_S3w";

const filesToIndex = [
    { path: './rulebooks/2025-NCAA.pdf', ruleSet: 'NCAA' },
    { path: './rulebooks/2025-CCA.pdf', ruleSet: 'NCAA' },
];
// --------------------------------

const pinecone = new Pinecone({ apiKey: PINECONE_API_KEY });
const genAI = new GoogleGenerativeAI(GOOGLE_API_KEY);
const pineconeIndex = pinecone.index("umpire-rules");

const chunkText = (text, chunkSize = 500, overlap = 50) => {
    const chunks = [];
    for (let i = 0; i < text.length; i += chunkSize - overlap) {
        chunks.push(text.substring(i, i + chunkSize));
    }
    return chunks;
};

// Function to add a delay
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function indexFile(filePath, ruleSet) {
    console.log(`Processing ${filePath}...`);

    const dataBuffer = fs.readFileSync(filePath);
    const pdfData = await pdf(dataBuffer);
    
    // Final, most robust text cleaning
    const cleanedText = pdfData.text
        .replace(/\s{2,}/g, ' ') // Replace multiple spaces/newlines with a single space
        .replace(/[^\x00-\x7F]/g, ''); // Remove all non-ASCII characters

    const textChunks = chunkText(cleanedText);
    console.log(`Split into ${textChunks.length} chunks.`);

    const model = genAI.getGenerativeModel({ model: "embedding-001" });
    const batchSize = 50; // Smaller batch size for safety

    for (let i = 0; i < textChunks.length; i += batchSize) {
        const batch = textChunks.slice(i, i + batchSize);
        console.log(`Processing batch ${Math.floor(i / batchSize) + 1} of ${Math.ceil(textChunks.length / batchSize)}...`);

        // Filter out any empty chunks that might have been created
        const nonEmptyBatch = batch.filter(chunk => chunk.trim() !== "");
        if (nonEmptyBatch.length === 0) {
            console.log("Skipping empty batch.");
            continue;
        }

        const result = await model.batchEmbedContents({
            requests: nonEmptyBatch.map(chunk => ({ content: chunk, taskType: "RETRIEVAL_DOCUMENT" }))
        });

        const embeddings = result.embeddings;
        const vectors = embeddings.map((embedding, j) => ({
            id: `${path.basename(filePath)}-${i + j}`,
            values: embedding.values,
            metadata: { text: nonEmptyBatch[j], ruleSet: ruleSet }
        }));
        
        await pineconeIndex.upsert(vectors);
        console.log(`Successfully indexed batch of ${vectors.length} vectors.`);
        
        // Add a delay of 1 second between batches to avoid rate limiting
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
        console.error("Indexing failed:", error.message);
    }
})();