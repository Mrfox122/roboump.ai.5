// === run-indexer.js ===
// Index rulebooks and glossary into Neon (Postgres + pgvector) for Gemini

import { GoogleGenerativeAI } from "@google/generative-ai";
import { Pool } from "pg";
import fs from "fs/promises";
import path from "path";

// === INITIALIZE ===
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const embeddingModel = genAI.getGenerativeModel({ model: "embedding-001" });
const pool = new Pool({ connectionString: process.env.NETLIFY_DATABASE_URL });

// === FILES TO INDEX ===
const filesToIndex = {
  "NCAA": './rulebooks/2025-NCAA.txt',
  "CCA": './rulebooks/2025-CCA.txt',
  "MLB": './rulebooks/2025-OBR.txt',
  "Glossary": './rulebooks/glossary.txt'
};

// === SETUP DATABASE ===
async function setupDatabase() {
  console.log("Setting up database schema...");
  const client = await pool.connect();
  try {
    // Make sure vector extension exists
    await client.query('CREATE EXTENSION IF NOT EXISTS vector;');
    
    // Create table if it doesn't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS rulebooks (
        id SERIAL PRIMARY KEY,
        content TEXT NOT NULL,
        ruleset TEXT NOT NULL,
        embedding VECTOR(768) NOT NULL
      );
    `);
    console.log("Database schema ready.");
  } finally {
    client.release();
  }
}

// === INDEX A SINGLE FILE ===
async function indexFile(filePath, ruleSet) {
  const absolutePath = path.join(process.cwd(), filePath);
  const text = await fs.readFile(absolutePath, 'utf-8');

  // Split text into chunks by ---
  const chunks = text
    .split('---')
    .map(c => c.trim())
    .filter(c => c.length > 10);

  console.log(`Split ${filePath} into ${chunks.length} chunks.`);

  const batchSize = 50;
  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    console.log(`Processing batch ${Math.floor(i / batchSize) + 1} of ${Math.ceil(chunks.length / batchSize)}...`);

    // 1. Get embeddings for batch
    const embeddingResult = await embeddingModel.batchEmbedContents({
      requests: batch.map(chunk => ({
        content: { parts: [{ text: chunk }] },
        taskType: "RETRIEVAL_DOCUMENT"
      }))
    });

    // 2. Insert batch into DB
    const client = await pool.connect();
    try {
      for (let j = 0; j < batch.length; j++) {
        const embeddingArray = embeddingResult.embeddings[j].values; // numeric array!
        await client.query(
          `INSERT INTO rulebooks (content, ruleset, embedding) VALUES ($1, $2, $3)`,
          [batch[j], ruleSet, embeddingArray]
        );
      }
    } finally {
      client.release();
    }
  }

  console.log(`Finished indexing ${ruleSet} with ${chunks.length} chunks.`);
  return `Finished indexing ${ruleSet}.\n`;
}

// === MAIN ===
async function main() {
  try {
    await setupDatabase();

    for (const [ruleSet, filePath] of Object.entries(filesToIndex)) {
      console.log(`\nStarting indexing for ${ruleSet}...`);
      
      // Clear old data for this ruleset
      await pool.query('DELETE FROM rulebooks WHERE ruleset = $1', [ruleSet]);
      
      await indexFile(filePath, ruleSet);
    }

    console.log("\nAll rulebooks and glossary indexed successfully!");
    process.exit(0);
  } catch (error) {
    console.error("Indexing failed:", error);
    process.exit(1);
  }
}

main();
