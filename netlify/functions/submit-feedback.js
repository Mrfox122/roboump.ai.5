import { Pool } from "pg";
const pool = new Pool({ connectionString: process.env.NETLIFY_DATABASE_URL });

export async function handler(event) {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }
    
    try {
        // Now expecting 'feedback_type' and optional 'comment'
        const { question, feedback_type, comment } = JSON.parse(event.body);

        if (!question || !feedback_type) {
            return { statusCode: 400, body: "Missing question or feedback type." };
        }

        const client = await pool.connect();
        try {
            // Find the most recent log for this question and update it
            const result = await client.query(
                `UPDATE query_logs 
                 SET feedback_type = $1, user_comment = $2
                 WHERE id = (SELECT max(id) FROM query_logs WHERE user_question = $3)
                 RETURNING id`,
                [feedback_type, comment || null, question]
            );

            if (result.rowCount === 0) {
                return { statusCode: 404, body: "Log entry not found to update." };
            }

            return { statusCode: 200, body: JSON.stringify({ message: "Feedback saved." }) };
        } finally {
            client.release();
        }

    } catch (error) {
        console.error("Feedback Error:", error);
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
}