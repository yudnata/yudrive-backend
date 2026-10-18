import { pool } from '../../config/db';
import { env } from '../../config/env';
import { AppError } from '../../middleware/errorHandler';

export interface StorageUsage {
  usedBytes: number;
  quotaBytes: number;
  percentage: number;
}

export async function getStorageUsage(): Promise<StorageUsage> {
  const result = await pool.query(
    `SELECT COALESCE(SUM(size_bytes), 0)::text AS total_used
     FROM media
     WHERE status = 'ready'`
  );

  const usedBytes = parseInt(result.rows[0]?.total_used || '0', 10);
  const quotaBytes = env.QUOTA_BYTES;
  const percentage = Math.min(100, Math.round((usedBytes / quotaBytes) * 1000) / 10);

  return {
    usedBytes,
    quotaBytes,
    percentage,
  };
}

import { getCloudflareUsage, CloudflareUsage } from '../r2-usage/r2-usage.service';

export { getCloudflareUsage, CloudflareUsage };

export async function getMe(userId: string): Promise<{
  user: { id: string; email: string; name: string; createdAt: string };
  usage: StorageUsage;
  r2Usage: CloudflareUsage;
}> {
  const userResult = await pool.query(
    'SELECT id, email, name, created_at FROM users WHERE id = $1',
    [userId]
  );

  if (userResult.rows.length === 0) {
    throw new AppError(404, 'USER_NOT_FOUND', 'Pengguna tidak ditemukan.');
  }

  const user = userResult.rows[0];
  const usage = await getStorageUsage();
  const r2Usage = await getCloudflareUsage();

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      createdAt: user.created_at.toISOString(),
    },
    usage,
    r2Usage,
  };
}

export async function getAllUsers(): Promise<Array<{ id: string; email: string; name: string }>> {
  const result = await pool.query(
    'SELECT id, email, name FROM users ORDER BY name ASC'
  );
  return result.rows;
}

