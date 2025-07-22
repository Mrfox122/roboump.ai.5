// netlify/functions/run-indexer.js (Updated for Semantic Chunking)

const { Pinecone } = require("@pinecone-database/pinecone");

const { GoogleGenerativeAI } = require("@google/generative-ai");

const fs = require("fs").promises;

const path = require("path");


const filesToIndex = [

    { path: './rulebooks/2025-NCAA.txt', ruleSet: ['NCAA'] },

    // Add your other files here when they are ready

];


const pinecone = new Pinecone(); 

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const pineconeIndex = pinecone.index("umpire-rules");

const embeddingModel = genAI.getGenerativeModel({ model: "embedding-001" });


async function indexFile(filePath, ruleSetArray) {

    console.log(`Processing ${filePath}...`);

    const absolutePath = path.resolve(__dirname, `../../${filePath}`);

    const text = await fs.readFile(absolutePath, 'utf-8');


    // This now splits the file by your "---" separator

    const textChunks = text.split('---').map(chunk => chunk.trim()).filter(chunk => chunk.length > 10);


    console.log(`Split into ${textChunks.length} semantic chunks.`);


    const batchSize = 50;

    for (let i = 0; i < textChunks.length; i += batchSize) {

        let batch = textChunks.slice(i, i + batchSize);

        console.log(`Processing batch ${Math.floor(i / batchSize) + 1} of ${Math.ceil(textChunks.length / batchSize)}...`);


        const result = await embeddingModel.batchEmbedContents({

            requests: batch.map(chunk => ({

                content: { parts: [{ text: chunk }] },

                taskType: "RETRIEVAL_DOCUMENT"

            }))

        });


        const vectors = result.embeddings.map((embedding, j) => ({

            id: `${path.basename(filePath)}-${i + j}`,

            values: embedding.values,

            metadata: { text: batch[j], ruleSet: ruleSetArray }

        }));

vectors.forEach(vector => {
  console.log(`Upserting vector id=${vector.id} with metadata text length=${vector.metadata?.text?.length || 0}`);
});

        await pineconeIndex.upsert(vectors);

        console.log(`Successfully indexed batch of ${vectors.length} vectors for ${filePath}.`);

    }

}


exports.handler = async function (event) {

    if (event.headers['x-secret-key'] !== '1234') { // Use your secret key

        return { statusCode: 401, body: 'Unauthorized' };

    }

    try {

        console.log("Starting semantic indexing process...");

        await pineconeIndex.deleteAll();

        console.log("Cleared old data from Pinecone index.");

        

        for (const file of filesToIndex) {

            await indexFile(file.path, file.ruleSet);

        }


        return {

            statusCode: 200,

            body: `Indexing complete! Processed ${filesToIndex.length} file(s).`,

        };

    } catch (error) {

        console.error("Indexing failed:", error);

        return {

            statusCode: 500,

            body: JSON.stringify({ error: error.message }),

        };

    }

}; 