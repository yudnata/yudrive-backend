import { Pool } from 'pg';
import { env } from './env';

const isSslRequired =
  env.NODE_ENV === 'production' ||
  env.DATABASE_URL.includes('neon.tech') ||
  env.DATABASE_URL.includes('sslmode=require');

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  ssl: isSslRequired ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client:', err);
});
