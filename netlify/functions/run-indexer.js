// netlify/functions/run-indexer.js
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { Pool } = require('pg');
const fs = require("fs").promises;
const path = require("path");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const embeddingModel = genAI.getGenerativeModel({ model: "embedding-001" });
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const filesToIndex = [
    { path: './rulebooks/2025-NCAA.txt', ruleSet: 'NCAA' },
    { path: './rulebooks/2025-CCA.txt',  ruleSet: 'CCA' },
    { path: './rulebooks/OBR-rules.txt', ruleSet: 'MLB' },
    { path: './rulebooks/glossary.txt', ruleSet: 'Glossary' }
];

// Setup DB schema
async function setupDatabase() {
    console.log("Setting up database schema...");
    const client = await pool.connect();
    try {
        await client.query('CREATE EXTENSION IF NOT EXISTS vector;');
        await client.query(`
            CREATE TABLE IF NOT EXISTS rulebook_snippets (
                id SERIAL PRIMARY KEY,
                text TEXT,
                term TEXT,
                rule_set TEXT,
                embedding VECTOR(768)
            );
        `);
        console.log("Database schema is ready.");
    } finally {
        client.release();
    }
}

// Index a single file
async function indexFile(filePath, ruleSet) {
    const absolutePath = path.resolve(__dirname, `../../${filePath}`);
    const text = await fs.readFile(absolutePath, 'utf-8');

    // Split text into chunks
    const textChunks = text.split('---')
        .map(chunk => chunk.trim())
        .filter(chunk => chunk.length > 10);

    console.log(`Split ${filePath} into ${textChunks.length} chunks.`);

    for (const chunk of textChunks) {
        const result = await embeddingModel.embedContent({
            content: { parts: [{ text: chunk }] },
            taskType: "RETRIEVAL_DOCUMENT"
        });
        const embedding = result.embedding.values;

        // Insert into database
        await pool.query(
            'INSERT INTO rulebook_snippets (text, rule_set, embedding) VALUES ($1, $2, $3)',
            [chunk, ruleSet, embedding]
        );
    }
}

// Main Netlify function handler
export async function handler(event) {
    const secret = event.headers['x-secret-key'];
    if (secret !== process.env.RUN_INDEXER_SECRET) {
        return { statusCode: 401, body: 'Unauthorized' };
    }
}


exports.handler = async function(event) {
    try {
        await setupDatabase();

        for (const file of filesToIndex) {
            await indexFile(file.path, file.ruleSet);
        }

        return {
            statusCode: 200,
            body: JSON.stringify({ message: 'Indexing complete!' })
        };
    } catch (err) {
        console.error(err);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: err.message })
        };
    }
};
