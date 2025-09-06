// run-indexer.js
// Run this with: node run-indexer.js
// Make sure package.json has "type": "module"

import { GoogleGenerativeAI } from "@google/generative-ai";
import { Pool } from "pg";
import fs from "fs/promises";
import path from "path";
import 'dotenv/config';

// === CONFIG ===
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const embeddingModel = genAI.getGenerativeModel({ model: "embedding-001" });

const pool = new Pool({
  connectionString: process.env.NETLIFY_DATABASE_URL
});

const filesToIndex = {
  "NCAA": './rulebooks/2025-NCAA.txt',
  "CCA": './rulebooks/2025-CCA.txt',
  "MLB": './rulebooks/2025-OBR.txt',
  "Glossary": './rulebooks/glossary.txt'
};

// === DATABASE SETUP ===
async function setupDatabase() {
  const client = await pool.connect();
  try {
    console.log("Setting up database schema...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS rulebooks (
        id SERIAL PRIMARY KEY,
        content TEXT NOT NULL,
        ruleset TEXT NOT NULL,
        embedding JSONB NOT NULL
      );
    `);
    console.log("Database ready.");
  } finally {
    client.release();
  }
}

// === INDEX A FILE ===
async function indexFile(filePath, ruleset) {
  const absolutePath = path.resolve(filePath);
  const text = await fs.readFile(absolutePath, 'utf-8');

  const chunks = text
    .split('---')
    .map(c => c.trim())
    .filter(c => c.length > 10);

  console.log(`Split ${filePath} into ${chunks.length} chunks.`);

  const batchSize = 50;

  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);

    // Create embeddings
    const embeddingResult = await embeddingModel.batchEmbedContents({
      requests: batch.map(textChunk => ({
        content: { parts: [{ text: textChunk }] },
        taskType: "RETRIEVAL_DOCUMENT"
      }))
    });

    const embeddings = embeddingResult.embeddings.map(e => e.values);

    // Insert batch into DB
    const values = [];
    const placeholders = [];

    batch.forEach((chunk, j) => {
      placeholders.push(`($${values.length + 1}, $${values.length + 2}, $${values.length + 3})`);
      values.push(chunk, ruleset, JSON.stringify(embeddings[j])); // store embedding as JSON
    });

    const query = `INSERT INTO rulebooks (content, ruleset, embedding) VALUES ${placeholders.join(', ')}`;
    await pool.query(query, values);
    console.log(`Inserted batch ${Math.floor(i / batchSize) + 1} of ${Math.ceil(chunks.length / batchSize)}`);
  }

  console.log(`Finished indexing ${ruleset}.`);
}

// === MAIN ===
async function main() {
  try {
    await setupDatabase();

    for (const [ruleset, filePath] of Object.entries(filesToIndex)) {
      console.log(`\nIndexing ${ruleset}...`);
      // Clear old data
      await pool.query('DELETE FROM rulebooks WHERE ruleset = $1', [ruleset]);
      await indexFile(filePath, ruleset);
    }

    console.log("\n✅ All rulebooks indexed successfully.");
    process.exit(0);
  } catch (err) {
    console.error("Error during indexing:", err);
    process.exit(1);
  }
}

main();
