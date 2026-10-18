import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().default('postgresql://localhost:5432/our_memories'),
  JWT_SECRET: z.string().min(16).default('development_super_secret_jwt_key_at_least_32_characters_long_12345'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  R2_ACCOUNT_ID: z.string().default('sample_account_id'),
  R2_ACCESS_KEY_ID: z.string().default('sample_key_id'),
  R2_SECRET_ACCESS_KEY: z.string().default('sample_secret_key'),
  R2_BUCKET: z.string().default('our-memories'),
  QUOTA_BYTES: z.coerce.number().default(9663676416), // 9 GB default
  MAX_FILE_BYTES: z.coerce.number().default(5368709120), // 5 GB default
  SEED_PASSWORD_1: z.string().optional(),
  SEED_PASSWORD_2: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.format());
  process.exit(1);
}

export const env = parsed.data;
