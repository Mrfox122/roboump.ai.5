import { GoogleGenerativeAI } from "@google/generative-ai";
import { Pool } from "pg";
import fs from "fs/promises";
import path from "path";

// === INITIALIZE ===
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const embeddingModel = genAI.getGenerativeModel({ model: "embedding-001" });
const pool = new Pool({ connectionString: process.env.NETLIFY_DATABASE_URL });

const filesToIndex = [
  { path: './rulebooks/2025-NCAA.txt', ruleSet: 'NCAA' },
  { path: './rulebooks/2025-CCA.txt',  ruleSet: 'CCA' },
  { path: './rulebooks/OBR-rules.txt', ruleSet: 'MLB' },
  { path: './rulebooks/glossary.txt', ruleSet: 'Glossary' }
];

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

// === INDEX A FILE ===
async function indexFile(filePath, ruleSet) {
  const absolutePath = path.resolve(process.cwd(), filePath);
  const text = await fs.readFile(absolutePath, 'utf-8');

  const textChunks = text
    .split('---')
    .map(chunk => chunk.trim())
    .filter(chunk => chunk.length > 10);

  console.log(`Split ${filePath} into ${textChunks.length} chunks.`);

  let chunkIndex = 0;
  for (const chunk of textChunks) {
    chunkIndex++;
    const result = await embeddingModel.embedContent({
      content: { parts: [{ text: chunk }] },
      taskType: "RETRIEVAL_DOCUMENT"
    });

    const embedding = result.embedding.values;

    await pool.query(
      'INSERT INTO rulebooks (content, ruleset, embedding) VALUES ($1, $2, $3)',
      [chunk, ruleSet, embedding]  // <-- raw array, not stringified
    );

    console.log(`Indexed chunk ${chunkIndex}/${textChunks.length} for ${ruleSet}`);
  }

  console.log(`Finished indexing ${filePath}`);
}

// === HANDLER ===
export async function handler(event) {
  try {
    const secret = event.headers['x-secret-key'];
    if (secret !== process.env.RUN_INDEXER_SECRET) {
      return { statusCode: 401, body: 'Unauthorized: Invalid secret key' };
    }

    console.log("Starting indexing process...");
    await setupDatabase();

    for (const file of filesToIndex) {
      await indexFile(file.path, file.ruleSet);
    }

    console.log("Indexing complete.");
    return {
      statusCode: 200,
      body: "Indexing complete. All files processed successfully."
    };
  } catch (error) {
    console.error("Error during indexing:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Internal Server Error", details: error.message })
    };
  }
}
