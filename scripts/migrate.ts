import fs from 'fs';
import path from 'path';
import { pool } from '../src/config/db';

async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    console.log('Running database migrations...');
    const migrationFile = path.join(__dirname, '../migrations/001_create_users_and_media.sql');
    const sql = fs.readFileSync(migrationFile, 'utf8');

    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');

    console.log('Database migrations applied successfully.');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigrations();
