import { GoogleGenerativeAI } from "@google/generative-ai";
import { Pool } from "pg";
import fs from "fs/promises";
import path from "path";

// === STEP 1: INITIALIZE ===
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const embeddingModel = genAI.getGenerativeModel({ model: "embedding-001" });
const pool = new Pool({ connectionString: process.env.NETLIFY_DATABASE_URL });

// Map file keys to paths
const filesToIndex = {
  "NCAA": './rulebooks/2025-NCAA.txt',
  "CCA": './rulebooks/2025-CCA.txt',
  "MLB": './rulebooks/OBR-rules.txt',
  "Glossary": './rulebooks/glossary.txt'
};

// === STEP 2: DATABASE SETUP ===
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

// === STEP 3: Validate embedding ===
function validateEmbedding(embedding) {
  if (!Array.isArray(embedding)) throw new Error("Embedding is not an array");
  if (embedding.length !== 768) throw new Error(`Embedding length is ${embedding.length}, expected 768`);
  if (!embedding.every(num => typeof num === "number")) throw new Error("Embedding contains non-number elements");
}

// === STEP 4: INDEX A SINGLE FILE ===
async function indexFile(filePath, ruleSet) {
  const absolutePath = path.join(process.cwd(), filePath);
  const text = await fs.readFile(absolutePath, 'utf-8');

  const textChunks = text
    .split('---')
    .map(chunk => chunk.trim())
    .filter(chunk => chunk.length > 10);

  console.log(`Split ${filePath} into ${textChunks.length} chunks.`);

  for (const [i, chunk] of textChunks.entries()) {
    const result = await embeddingModel.embedContent({
      content: { parts: [{ text: chunk }] },
      taskType: "RETRIEVAL_DOCUMENT"
    });

    const embedding = result.embedding.values;

    validateEmbedding(embedding);

    await pool.query(
      'INSERT INTO rulebooks (content, ruleset, embedding) VALUES ($1, $2, $3)',
      [chunk, ruleSet, embedding]
    );

    console.log(`Indexed chunk ${i + 1} of ${textChunks.length}`);
  }

  console.log(`Finished indexing ${filePath}`);
  return `Finished indexing ${ruleSet} with ${textChunks.length} chunks.\n`;
}

// === STEP 5: EXPORT HANDLER ===
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
    const resultMsg = await indexFile(filesToIndex[fileKey], fileKey);

    return { statusCode: 200, body: resultMsg };
  } catch (error) {
    console.error("Error during indexing:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Internal Server Error", details: error.message })
    };
  }
}
