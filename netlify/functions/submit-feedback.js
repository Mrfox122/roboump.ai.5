import { Pool } from "pg";
const pool = new Pool({ connectionString: process.env.NETLIFY_DATABASE_URL });

export async function handler(event) {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
    
    try {
        const { question, score } = JSON.parse(event.body); // score: 1 or -1

        const client = await pool.connect();
        
        // Update the MOST RECENT log for this specific question
        // This links the user's click to the AI's last thought process
        const result = await client.query(
            `UPDATE query_logs 
             SET user_feedback_score = $1 
             WHERE user_question = $2 
             AND id = (SELECT max(id) FROM query_logs WHERE user_question = $2)
             RETURNING id`,
            [score, question]
        );
        
        client.release();

        if (result.rowCount === 0) {
            return { statusCode: 404, body: "Log entry not found to update." };
        }

        return { statusCode: 200, body: "Feedback saved." };

    } catch (error) {
        console.error("Feedback Error:", error);
        return { statusCode: 500, body: error.message };
    }
}