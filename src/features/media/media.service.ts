import path from 'path';
import { pool } from '../../config/db';
import { AppError } from '../../middleware/errorHandler';
import { r2Service } from '../uploads/r2.service';
import { cleanupStalePendingMedia } from '../uploads/uploads.service';
import { ListMediaQuery } from './media.schema';

interface DecodedCursor {
  sortTime: string;
  id: string;
}

function decodeCursor(cursorStr?: string): DecodedCursor | null {
  if (!cursorStr) return null;
  try {
    const json = Buffer.from(cursorStr, 'base64url').toString('utf8');
    const parsed = JSON.parse(json);
    if (parsed.sortTime && parsed.id) return parsed;
    return null;
  } catch {
    return null;
  }
}

function encodeCursor(sortTime: string, id: string): string {
  const json = JSON.stringify({ sortTime, id });
  return Buffer.from(json, 'utf8').toString('base64url');
}

export async function listMedia(query: ListMediaQuery) {
  // Trigger non-blocking cleanup of stale pending uploads
  cleanupStalePendingMedia().catch((err) => {
    console.error('Background cleanup error during listMedia:', err);
  });

  const cursor = decodeCursor(query.cursor);
  const limit = query.limit;

  let sql = `
    SELECT id, owner_id, type, object_key, thumb_key, mime, size_bytes,
           width, height, duration_sec, taken_at, created_at,
           COALESCE(taken_at, created_at) AS sort_time
    FROM media
    WHERE status = 'ready'
  `;
  const params: any[] = [];

  if (cursor) {
    params.push(cursor.sortTime, cursor.id);
    sql += ` AND (COALESCE(taken_at, created_at), id) < ($1::timestamptz, $2::uuid)`;
  }

  const limitParamIndex = params.length + 1;
  params.push(limit + 1);
  sql += ` ORDER BY sort_time DESC, id DESC LIMIT $${limitParamIndex}`;

  const result = await pool.query(sql, params);
  const hasMore = result.rows.length > limit;
  const rows = hasMore ? result.rows.slice(0, limit) : result.rows;

  // Generate presigned GET URLs for thumbnails in parallel
  const items = await Promise.all(
    rows.map(async (row) => {
      let thumbUrl: string | undefined;
      if (row.thumb_key) {
        try {
          thumbUrl = await r2Service.getPresignedGetUrl(row.thumb_key, 3600);
        } catch (err) {
          console.error(`Failed to generate thumb presigned GET for ${row.id}:`, err);
        }
      }

      return {
        id: row.id,
        ownerId: row.owner_id,
        type: row.type,
        mime: row.mime,
        sizeBytes: Number(row.size_bytes),
        width: row.width,
        height: row.height,
        durationSec: row.duration_sec ? Number(row.duration_sec) : undefined,
        takenAt: row.taken_at ? row.taken_at.toISOString() : undefined,
        createdAt: row.created_at.toISOString(),
        thumbUrl,
      };
    })
  );

  let nextCursor: string | undefined;
  if (hasMore && rows.length > 0) {
    const lastRow = rows[rows.length - 1];
    nextCursor = encodeCursor(lastRow.sort_time.toISOString(), lastRow.id);
  }

  return {
    items,
    nextCursor,
  };
}

export async function getMediaOriginalUrl(mediaId: string) {
  const result = await pool.query(
    `SELECT id, object_key, mime, size_bytes, status
     FROM media
     WHERE id = $1 AND status = 'ready'`,
    [mediaId]
  );

  if (result.rows.length === 0) {
    throw new AppError(404, 'MEDIA_NOT_FOUND', 'Media tidak ditemukan.');
  }

  const media = result.rows[0];
  const url = await r2Service.getPresignedGetUrl(media.object_key, 3600);

  return {
    url,
    mime: media.mime,
    sizeBytes: Number(media.size_bytes),
    filename: path.basename(media.object_key),
  };
}

export async function deleteMedia(mediaId: string, userId: string) {
  const result = await pool.query(
    `SELECT id, owner_id, object_key, thumb_key
     FROM media
     WHERE id = $1`,
    [mediaId]
  );

  if (result.rows.length === 0) {
    throw new AppError(404, 'MEDIA_NOT_FOUND', 'Media tidak ditemukan.');
  }

  const media = result.rows[0];
  if (media.owner_id !== userId) {
    throw new AppError(
      403,
      'FORBIDDEN',
      'Hanya pemilik yang dapat menghapus media ini.'
    );
  }

  // Delete from R2 storage
  await r2Service.deleteObject(media.object_key).catch(() => {});
  if (media.thumb_key) {
    await r2Service.deleteObject(media.thumb_key).catch(() => {});
  }

  // Delete from database
  await pool.query('DELETE FROM media WHERE id = $1', [media.id]);

  return { success: true };
}
