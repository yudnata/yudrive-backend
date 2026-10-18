import path from 'path';
import { pool } from '../../config/db';
import { AppError } from '../../middleware/errorHandler';
import { r2Service } from '../uploads/r2.service';
import { cleanupStalePendingMedia } from '../uploads/uploads.service';
import { getFolderCloudflarePath } from '../folders/folders.service';
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
           width, height, duration_sec, taken_at, created_at, folder_id,
           COALESCE(taken_at, created_at) AS sort_time
    FROM media
    WHERE status = 'ready'
  `;
  const params: any[] = [];

  if (query.folderId) {
    if (query.folderId === 'root' || query.folderId === 'null') {
      sql += ` AND folder_id IS NULL`;
    } else if (query.folderId !== 'all') {
      params.push(query.folderId);
      sql += ` AND folder_id = $${params.length}`;
    }
  }

  if (cursor) {
    params.push(cursor.sortTime, cursor.id);
    sql += ` AND (COALESCE(taken_at, created_at), id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`;
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
        folderId: row.folder_id || undefined,
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

export async function moveMedia(
  mediaId: string,
  targetFolderId: string | null | undefined,
  userId: string
) {
  const result = await pool.query(
    `SELECT id, owner_id, object_key, thumb_key, folder_id, type, mime, size_bytes, width, height, duration_sec, taken_at, created_at
     FROM media
     WHERE id = $1`,
    [mediaId]
  );

  if (result.rows.length === 0) {
    throw new AppError(404, 'MEDIA_NOT_FOUND', 'Media tidak ditemukan.');
  }

  const media = result.rows[0];
  if (media.owner_id !== userId) {
    throw new AppError(403, 'FORBIDDEN', 'Hanya pemilik yang dapat memindahkan media ini.');
  }

  const normalizedTargetFolderId = targetFolderId || null;

  // If target folder is specified, verify it exists
  if (normalizedTargetFolderId) {
    const folderCheck = await pool.query(`SELECT id FROM folders WHERE id = $1`, [normalizedTargetFolderId]);
    if (folderCheck.rows.length === 0) {
      throw new AppError(404, 'FOLDER_NOT_FOUND', 'Folder tujuan tidak ditemukan.');
    }
  }

  // If already in target folder, return current item
  if (media.folder_id === normalizedTargetFolderId) {
    let thumbUrl: string | undefined;
    if (media.thumb_key) {
      thumbUrl = await r2Service.getPresignedGetUrl(media.thumb_key, 3600).catch(() => undefined);
    }
    return {
      id: media.id,
      ownerId: media.owner_id,
      folderId: media.folder_id || undefined,
      type: media.type,
      mime: media.mime,
      sizeBytes: Number(media.size_bytes),
      width: media.width,
      height: media.height,
      durationSec: media.duration_sec ? Number(media.duration_sec) : undefined,
      takenAt: media.taken_at ? media.taken_at.toISOString() : undefined,
      createdAt: media.created_at.toISOString(),
      thumbUrl,
    };
  }

  // Calculate new object key in Cloudflare R2
  const oldObjectKey: string = media.object_key;
  const filename = path.basename(oldObjectKey);
  const folderPrefix = await getFolderCloudflarePath(normalizedTargetFolderId);
  const newObjectKey = `${folderPrefix}/${filename}`;

  // Move in Cloudflare R2 if key changed
  if (newObjectKey !== oldObjectKey) {
    try {
      await r2Service.copyObject(oldObjectKey, newObjectKey);
      await r2Service.deleteObject(oldObjectKey);
    } catch (err) {
      console.error(`Failed to move object in Cloudflare R2 from ${oldObjectKey} to ${newObjectKey}:`, err);
    }
  }

  // Update PostgreSQL database record
  const updatedResult = await pool.query(
    `UPDATE media
     SET folder_id = $1, object_key = $2, updated_at = now()
     WHERE id = $3
     RETURNING id, owner_id, folder_id, type, mime, size_bytes, width, height, duration_sec, taken_at, created_at, thumb_key`,
    [normalizedTargetFolderId, newObjectKey, mediaId]
  );

  const updated = updatedResult.rows[0];
  let thumbUrl: string | undefined;
  if (updated.thumb_key) {
    thumbUrl = await r2Service.getPresignedGetUrl(updated.thumb_key, 3600).catch(() => undefined);
  }

  return {
    id: updated.id,
    ownerId: updated.owner_id,
    folderId: updated.folder_id || undefined,
    type: updated.type,
    mime: updated.mime,
    sizeBytes: Number(updated.size_bytes),
    width: updated.width,
    height: updated.height,
    durationSec: updated.duration_sec ? Number(updated.duration_sec) : undefined,
    takenAt: updated.taken_at ? updated.taken_at.toISOString() : undefined,
    createdAt: updated.created_at.toISOString(),
    thumbUrl,
  };
}

export async function batchDeleteMedia(ids: string[], userId: string) {
  if (ids.length === 0) return { deletedCount: 0 };

  const result = await pool.query(
    `SELECT id, owner_id, object_key, thumb_key
     FROM media
     WHERE id = ANY($1::uuid[]) AND owner_id = $2`,
    [ids, userId]
  );

  const rows = result.rows;
  if (rows.length === 0) return { deletedCount: 0 };

  // Delete objects from Cloudflare R2
  await Promise.all(
    rows.map(async (row) => {
      await r2Service.deleteObject(row.object_key).catch(() => {});
      if (row.thumb_key) {
        await r2Service.deleteObject(row.thumb_key).catch(() => {});
      }
    })
  );

  const matchedIds = rows.map((r) => r.id);
  await pool.query(
    `DELETE FROM media WHERE id = ANY($1::uuid[])`,
    [matchedIds]
  );

  return { deletedCount: matchedIds.length };
}

export async function batchMoveMedia(
  ids: string[],
  targetFolderId: string | null | undefined,
  userId: string
) {
  if (ids.length === 0) return { movedCount: 0 };

  const normalizedTargetFolderId = targetFolderId || null;

  if (normalizedTargetFolderId) {
    const folderCheck = await pool.query(`SELECT id FROM folders WHERE id = $1`, [normalizedTargetFolderId]);
    if (folderCheck.rows.length === 0) {
      throw new AppError(404, 'FOLDER_NOT_FOUND', 'Folder tujuan tidak ditemukan.');
    }
  }

  const result = await pool.query(
    `SELECT id, owner_id, object_key, folder_id
     FROM media
     WHERE id = ANY($1::uuid[]) AND owner_id = $2`,
    [ids, userId]
  );

  const rows = result.rows;
  if (rows.length === 0) return { movedCount: 0 };

  const folderPrefix = await getFolderCloudflarePath(normalizedTargetFolderId);

  // Move each file in Cloudflare R2 and update database
  await Promise.all(
    rows.map(async (row) => {
      const oldObjectKey: string = row.object_key;
      const filename = path.basename(oldObjectKey);
      const newObjectKey = `${folderPrefix}/${filename}`;

      if (newObjectKey !== oldObjectKey) {
        try {
          await r2Service.copyObject(oldObjectKey, newObjectKey);
          await r2Service.deleteObject(oldObjectKey);
        } catch (err) {
          console.error(`Failed to move object in Cloudflare R2 from ${oldObjectKey} to ${newObjectKey}:`, err);
        }
      }

      await pool.query(
        `UPDATE media SET folder_id = $1, object_key = $2, updated_at = now() WHERE id = $3`,
        [normalizedTargetFolderId, newObjectKey, row.id]
      );
    })
  );

  return { movedCount: rows.length };
}
