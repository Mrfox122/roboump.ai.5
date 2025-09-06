import { GoogleGenerativeAI } from "@google/generative-ai";
import { Pool } from "pg";
import fs from "fs/promises";
import path from "path";

// === INITIALIZE ===
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const embeddingModel = genAI.getGenerativeModel({ model: "embedding-001" });
const pool = new Pool({ connectionString: process.env.NETLIFY_DATABASE_URL });

const filesToIndex = {
  "NCAA": './rulebooks/2025-NCAA.txt',
  "CCA": './rulebooks/2025-CCA.txt',
  "MLB": './rulebooks/2025-OBR.txt',
  "Glossary": './rulebooks/glossary.txt'
};

// === DATABASE SETUP ===
async function setupDatabase() {
  console.log("Setting up database schema...");
  const client = await pool.connect();
  try {
    await client.query('CREATE EXTENSION IF NOT EXISTS vector;');
    await client.query(`
      CREATE TABLE IF NOT EXISTS rulebooks (
        id SERIAL PRIMARY KEY,
        content TEXT,
        ruleset TEXT,
        embedding VECTOR(768)
      );
    `);
    console.log("Database schema ready.");
  } finally {
    client.release();
  }
}

// === BATCH INDEX A FILE ===
// === BATCH INDEX A FILE (pgvector-compatible) ===
async function indexFile(filePath, ruleSet) {
  const absolutePath = path.join(process.cwd(), filePath);
  const text = await fs.readFile(absolutePath, 'utf-8');

  // Split text into chunks
  const textChunks = text
    .split('---')
    .map(chunk => chunk.trim())
    .filter(chunk => chunk.length > 10);

  console.log(`Split ${filePath} into ${textChunks.length} chunks.`);

  const batchSize = 50; // Process 50 chunks at a time

  for (let i = 0; i < textChunks.length; i += batchSize) {
    const batchChunks = textChunks.slice(i, i + batchSize);
    console.log(`Processing batch ${Math.floor(i / batchSize) + 1} of ${Math.ceil(textChunks.length / batchSize)}...`);

    // 1. Create embeddings for the entire batch at once
    const embeddingResult = await embeddingModel.batchEmbedContents({
      requests: batchChunks.map(chunk => ({
        content: { parts: [{ text: chunk }] },
        taskType: "RETRIEVAL_DOCUMENT"
      }))
    });

    const embeddings = embeddingResult.embeddings.map(e => e.values); // numeric arrays

    // 2. Insert batch into PostgreSQL using pgvector
    const client = await pool.connect();
    try {
      const placeholders = [];
      const values = [];
      batchChunks.forEach((chunk, j) => {
        placeholders.push(`($${values.length + 1}, $${values.length + 2}, $${values.length + 3})`);
        values.push(chunk, ruleSet, embeddings[j]); // <-- embed as numeric array
      });

      const queryText = `INSERT INTO rulebooks (content, ruleset, embedding) VALUES ${placeholders.join(', ')}`;
      await client.query(queryText, values);
    } finally {
      client.release();
    }
  }

  console.log(`Finished indexing ${filePath}`);
  return `Finished indexing ${ruleSet} with ${textChunks.length} chunks.\n`;
}

// === HANDLER ===
export async function handler(event) {
  try {
    const secret = event.headers['x-secret-key'];
    if (secret !== process.env.RUN_INDEXER_SECRET) {
      return { statusCode: 401, body: 'Unauthorized: Invalid secret key' };
    }

    const fileKey = event.headers['x-file-key'];
    if (!fileKey || !filesToIndex[fileKey]) {
      return { statusCode: 400, body: 'Bad Request: Invalid or missing file key' };
    }

    await setupDatabase();

    // Clear old data for the specific ruleset before indexing
    console.log(`Clearing old data for ruleset: ${fileKey}`);
    await pool.query('DELETE FROM rulebooks WHERE ruleset = $1', [fileKey]);

    const resultMsg = await indexFile(filesToIndex[fileKey], fileKey);

    console.log("Indexing complete.");
    return {
      statusCode: 200,
      body: resultMsg
    };
  } catch (error) {
    console.error("Error during indexing:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Internal Server Error", details: error.message })
    };
  }
}