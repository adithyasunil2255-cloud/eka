import pg from 'pg';
const { Pool } = pg;

// Suga will inject DATABASE_URL automatically when you connect the DB
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('sslmode=require') 
    ? { rejectUnauthorized: false } 
    : false,
});