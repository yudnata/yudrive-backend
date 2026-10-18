import argon2 from 'argon2';
import { pool } from '../src/config/db';
import { env } from '../src/config/env';

async function seedUsers(): Promise<void> {
  const pwd1 = env.SEED_PASSWORD_1 || 'memories_partner1_secret';
  const pwd2 = env.SEED_PASSWORD_2 || 'memories_partner2_secret';

  const hash1 = await argon2.hash(pwd1);
  const hash2 = await argon2.hash(pwd2);

  const users = [
    { email: 'user1@ourmemories.local', name: 'Partner 1', hash: hash1 },
    { email: 'user2@ourmemories.local', name: 'Partner 2', hash: hash2 },
  ];

  const client = await pool.connect();
  try {
    console.log('Seeding initial 2 users...');
    for (const u of users) {
      await client.query(
        `INSERT INTO users (email, name, password_hash)
         VALUES ($1, $2, $3)
         ON CONFLICT (email)
         DO UPDATE SET name = EXCLUDED.name, password_hash = EXCLUDED.password_hash`,
        [u.email, u.name, u.hash]
      );
      console.log(`Seeded user: ${u.email}`);
    }
    console.log('Seeding completed successfully.');
  } catch (error) {
    console.error('Seeding failed:', error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seedUsers();
