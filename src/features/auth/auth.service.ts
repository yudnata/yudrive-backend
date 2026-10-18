import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import { pool } from '../../config/db';
import { env } from '../../config/env';
import { AppError } from '../../middleware/errorHandler';
import { LoginInput } from './auth.schema';
import { cleanupStalePendingMedia } from '../uploads/uploads.service';

export async function login(input: LoginInput): Promise<{ token: string; user: { id: string; email: string; name: string } }> {
  const result = await pool.query(
    'SELECT id, email, name, password_hash FROM users WHERE email = $1',
    [input.email.toLowerCase().trim()]
  );

  if (result.rows.length === 0) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Email atau kata sandi tidak sesuai.');
  }

  const user = result.rows[0];
  const isPasswordValid = await argon2.verify(user.password_hash, input.password);

  if (!isPasswordValid) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Email atau kata sandi tidak sesuai.');
  }

  const payload = {
    id: user.id,
    email: user.email,
    name: user.name,
  };

  const token = jwt.sign(payload, env.JWT_SECRET, { expiresIn: '30d' });

  // Trigger stale upload cleanup in background without blocking response
  cleanupStalePendingMedia().catch((err) => {
    console.error('Background cleanup error during login:', err);
  });

  return {
    token,
    user: payload,
  };
}
