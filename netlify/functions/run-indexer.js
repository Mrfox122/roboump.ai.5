// netlify/functions/run-indexer.js
// Purpose: Index rulebooks + glossary into Neon pgvector for Gemini retrieval

const { GoogleGenerativeAI } = require("@google/generative-ai");
const { Pool } = require("pg");
const fs = require("fs").promises;
const path = require("path");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const embeddingModel = genAI.getGenerativeModel({ model: "embedding-001" });
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const filesToIndex = [
    { path: "./rulebooks/2025-NCAA.txt", ruleSet: "NCAA" },
    { path: "./rulebooks/2025-CCA.txt", ruleSet: "CCA" },
    { path: "./rulebooks/OBR-rules.txt", ruleSet: "MLB" },
    { path: "./rulebooks/glossary.txt", ruleSet: "Glossary" }
];

async function setupDatabase() {
    console.log("Setting up database schema...");
    const client = await pool.connect();
    try {
        await client.query("CREATE EXTENSION IF NOT EXISTS vector;");
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

async function indexFile(filePath, ruleSet) {
    const absolutePath = path.resolve(__dirname, `../../${filePath}`);
    const text = await fs.readFile(absolutePath, "utf-8");

    // Handle glossary vs. rulebook differently
    let textChunks;
    if (ruleSet === "Glossary") {
        textChunks = text
            .split("---")
            .map(chunk => chunk.trim())
            .filter(chunk => chunk.includes("-"))
            .map(entry => {
                const [term, definition] = entry.split("-").map(s => s.trim());
                return { term, text: definition };
            });
    } else {
        textChunks = text
            .split("---")
            .map(chunk => ({ term: null, text: chunk.trim() }))
            .filter(chunk => chunk.text.length > 10);
    }

    console.log(`Split ${filePath} into ${textChunks.length} chunks.`);

    for (const chunk of textChunks) {
        const result = await embeddingModel.embedContent({
            content: { parts: [{ text: chunk.text }] },
            taskType: "RETRIEVAL_DOCUMENT"
        });
        const embedding = result.embedding.values;

        await pool.query(
            `INSERT INTO rulebook_snippets (text, term, rule_set, embedding)
             VALUES ($1, $2, $3, $4)`,
            [chunk.text, chunk.term, ruleSet, `[${embedding.join(",")}]`]
        );
    }

    console.log(`Indexed ${textChunks.length} entries from ${filePath}`);
}

async function main() {
    await setupDatabase();
    for (const file of filesToIndex) {
        await indexFile(file.path, file.ruleSet);
    }
    console.log("✅ Indexing complete!");
    process.exit(0);
}

main().catch(err => {
    console.error("❌ Indexing failed:", err);
    process.exit(1);
});
