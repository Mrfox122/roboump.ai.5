import { GoogleGenerativeAI } from "@google/generative-ai";
import { Pool } from "pg";
import fs from "fs/promises";
import path from "path";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const embeddingModel = genAI.getGenerativeModel({ model: "embedding-001" });
const pool = new Pool({ connectionString: process.env.NETLIFY_DATABASE_URL });

const filesToIndex = {
  "NCAA": './rulebooks/2025-NCAA.txt',
  "CCA": './rulebooks/2025-CCA.txt',
  "MLB": './rulebooks/2025-OBR.txt',
  "Glossary": './rulebooks/glossary.txt'
};

export async function handler(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  const fileKey = event.headers['x-file-key'];
  if (!filesToIndex[fileKey]) return { statusCode: 400, body: `Invalid selection` };

  try {
    // 1. Read and Chunk
    const filePath = filesToIndex[fileKey];
    const absolutePath = path.resolve(process.cwd(), filePath);
    const text = await fs.readFile(absolutePath, 'utf-8');
    const chunks = text.split('---').map(c => c.trim()).filter(c => c.length > 10);
    
    console.log(`Processing ${chunks.length} chunks for ${fileKey}...`);

    const client = await pool.connect();
    
    try {
        // 2. Prep Database (Create table if missing, Clear old rules)
        await client.query(`
            CREATE TABLE IF NOT EXISTS rulebooks (
                id SERIAL PRIMARY KEY,
                content TEXT NOT NULL,
                ruleset TEXT NOT NULL,
                embedding JSONB NOT NULL
            );
        `);
        await client.query('DELETE FROM rulebooks WHERE ruleset = $1', [fileKey]);
        
        // 3. Process in LARGER Batches (Speed Boost #1)
        // We can do 100 at a time with Google, which is much faster than 20
        const batchSize = 50; 
        
        for (let i = 0; i < chunks.length; i += batchSize) {
            const batch = chunks.slice(i, i + batchSize);
            
            // A. Get Embeddings (One call to Google)
            console.log(`Fetching embeddings for batch ${Math.floor(i / batchSize) + 1}...`);
            const embeddingResult = await embeddingModel.batchEmbedContents({
                requests: batch.map(t => ({ content: { parts: [{ text: t }] }, taskType: "RETRIEVAL_DOCUMENT" }))
            });
            const embeddings = embeddingResult.embeddings.map(e => e.values);

            // B. SQL Bulk Insert (Speed Boost #2)
            // Instead of looping await client.query(), we build ONE giant query.
            
            const values = [];
            const placeholders = [];
            
            batch.forEach((chunk, index) => {
                const offset = index * 3; // 3 parameters per row ($1, $2, $3)
                placeholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3})`);
                values.push(chunk, fileKey, JSON.stringify(embeddings[index]));
            });

            const queryText = `
                INSERT INTO rulebooks (content, ruleset, embedding) 
                VALUES ${placeholders.join(', ')}
            `;

            // ONE call to database per batch
            await client.query(queryText, values);
            console.log(`Saved batch ${Math.floor(i / batchSize) + 1} to DB.`);
        }

        return { statusCode: 200, body: `Success! Indexed ${chunks.length} rules.` };

    } finally {
        client.release();
    }

  } catch (error) {
    console.error("Error:", error);
    return { statusCode: 500, body: error.message };
  }
}