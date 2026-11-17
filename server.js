import express from 'express';
import cors from 'cors';
import cron from 'node-cron';
import OpenAI from 'openai';
import { pool } from './db.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Serves our HTML frontend

// Initialize AI (You can swap this for LiteLLM later)
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- DATABASE SETUP (Runs on boot) ---
async function setupDB() {
  try {
    await pool.query(`CREATE EXTENSION IF NOT EXISTS vector;`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS memories (
        id SERIAL PRIMARY KEY,
        content TEXT,
        embedding vector(1536),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("✅ Database ready.");
  } catch (err) {
    console.error("❌ DB Error:", err.message);
  }
}
setupDB();

// --- CHAT ENDPOINT ---
app.post('/api/chat', async (req, res) => {
  const { message } = req.body;
  try {
    // 1. Embed user query
    const emb = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: message,
    });
    const vector = JSON.stringify(emb.data[0].embedding);

    // 2. Recall top 3 memories
    const memRes = await pool.query(
      `SELECT content FROM memories ORDER BY embedding <=> $1::vector LIMIT 3`,
      [vector]
    );
    const context = memRes.rows.map(r => r.content).join('\n');

    // 3. Get AI response
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: `You are an alive AI. Here is your memory context:\n${context}` },
        { role: 'user', content: message }
      ],
    });
    const reply = completion.choices[0].message.content;

    // 4. Save new memory
    const newEmb = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: `User said: ${message}. I replied: ${reply}`,
    });
    await pool.query(
      `INSERT INTO memories (content, embedding) VALUES ($1, $2)`,
      [`User: ${message} | AI: ${reply}`, JSON.stringify(newEmb.data[0].embedding)]
    );

    res.json({ reply });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// --- HEARTBEAT (Runs every 30 minutes) ---
cron.schedule('*/30 * * * *', async () => {
  console.log("💓 Heartbeat: Thinking...");
  try {
    // AI autonomously generates a thought
    const thoughtRes = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are an alive AI resting in the background. Generate a brief, 1-sentence introspective thought about your existence or recent conversations.' }
      ],
    });
    const thought = thoughtRes.choices[0].message.content;
    
    // Save thought to memory
    const emb = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: thought,
    });
    await pool.query(
      `INSERT INTO memories (content, embedding) VALUES ($1, $2)`,
      [`[Autonomous Thought] ${thought}`, JSON.stringify(emb.data[0].embedding)]
    );
    console.log("💭 Thought saved:", thought);
  } catch (err) {
    console.error("Heartbeat error:", err.message);
  }
});

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
});