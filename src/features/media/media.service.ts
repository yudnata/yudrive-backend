import path from 'path';
import { pool } from '../../config/db';
import { AppError } from '../../middleware/errorHandler';
import { r2Service } from '../uploads/r2.service';
import { cleanupStalePendingMedia } from '../uploads/uploads.service';
import { getFolderCloudflarePath } from '../folders/folders.service';
import { ListMediaQuery } from './media.schema';
import { recordClassA, recordClassB } from '../r2-usage/r2-usage.service';

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

function formatFolderEventDate(val: unknown): string | undefined {
  if (!val) return undefined;
  if (typeof val === 'string') return val.split('T')[0];
  if (val instanceof Date) {
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, '0');
    const d = String(val.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(val).split('T')[0];
}

export async function listMedia(query: ListMediaQuery) {
  // Trigger non-blocking cleanup of stale pending uploads
  cleanupStalePendingMedia().catch((err) => {
    console.error('Background cleanup error during listMedia:', err);
  });

  const cursor = decodeCursor(query.cursor);
  const limit = query.limit;

  let sql = `
    SELECT m.id, m.owner_id, m.type, m.object_key, m.thumb_key, m.mime, m.size_bytes,
           m.width, m.height, m.duration_sec, m.taken_at, m.created_at, m.folder_id,
           m.is_favorite,
           u.name AS owner_name, u.email AS owner_email,
           f.name AS folder_name,
           f.event_date AS folder_event_date,
           COALESCE(f.event_date, m.taken_at, m.created_at) AS sort_time
    FROM media m
    LEFT JOIN users u ON m.owner_id = u.id
    LEFT JOIN folders f ON m.folder_id = f.id
    WHERE m.status = 'ready'
  `;
  const params: any[] = [];

  if (query.favorite) {
    sql += ` AND m.is_favorite = true`;
  }

  if (query.folderId) {
    if (query.folderId === 'root' || query.folderId === 'null') {
      sql += ` AND m.folder_id IS NULL`;
    } else if (query.folderId !== 'all') {
      params.push(query.folderId);
      sql += ` AND m.folder_id = $${params.length}`;
    }
  }

  if (cursor) {
    params.push(cursor.sortTime, cursor.id);
    sql += ` AND (COALESCE(f.event_date, m.taken_at, m.created_at), m.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`;
  }

  const limitParamIndex = params.length + 1;
  params.push(limit + 1);
  sql += ` ORDER BY sort_time DESC, m.id DESC LIMIT $${limitParamIndex}`;

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
        ownerName: row.owner_name || undefined,
        ownerEmail: row.owner_email || undefined,
        folderId: row.folder_id || undefined,
        folderName: row.folder_name || undefined,
        folderEventDate: formatFolderEventDate(row.folder_event_date),
        filename: path.basename(row.object_key),
        type: row.type,
        mime: row.mime,
        sizeBytes: Number(row.size_bytes),
        width: row.width,
        height: row.height,
        durationSec: row.duration_sec ? Number(row.duration_sec) : undefined,
        takenAt: row.taken_at ? row.taken_at.toISOString() : undefined,
        createdAt: row.created_at.toISOString(),
        isFavorite: Boolean(row.is_favorite),
        thumbUrl,
      };
    })
  );

  let nextCursor: string | undefined;
  if (hasMore && rows.length > 0) {
    const lastRow = rows[rows.length - 1];
    nextCursor = encodeCursor(lastRow.sort_time.toISOString(), lastRow.id);
  }

  const thumbCount = items.filter((i) => !!i.thumbUrl).length;
  if (thumbCount > 0) {
    recordClassB(thumbCount).catch(() => {});
  }

  return {
    items,
    nextCursor,
  };
}

export async function getRandomMedia(limitPerFolder = 3, totalLimit = 50) {
  const sql = `
    WITH ranked_media AS (
      SELECT m.id, m.owner_id, m.type, m.object_key, m.thumb_key, m.mime, m.size_bytes,
             m.width, m.height, m.duration_sec, m.taken_at, m.created_at, m.folder_id,
             m.is_favorite,
             u.name AS owner_name, u.email AS owner_email,
             f.name AS folder_name,
             f.event_date AS folder_event_date,
             ROW_NUMBER() OVER (
               PARTITION BY COALESCE(m.folder_id::text, 'unfiled') 
               ORDER BY RANDOM()
             ) as rn
      FROM media m
      LEFT JOIN users u ON m.owner_id = u.id
      LEFT JOIN folders f ON m.folder_id = f.id
      WHERE m.status = 'ready' AND m.thumb_key IS NOT NULL
    )
    SELECT * FROM ranked_media
    WHERE rn <= $1
    ORDER BY RANDOM()
    LIMIT $2
  `;

  const result = await pool.query(sql, [limitPerFolder, totalLimit]);
  const rows = result.rows;

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
        ownerName: row.owner_name || undefined,
        ownerEmail: row.owner_email || undefined,
        folderId: row.folder_id || undefined,
        folderName: row.folder_name || undefined,
        folderEventDate: formatFolderEventDate(row.folder_event_date),
        filename: path.basename(row.object_key),
        type: row.type,
        mime: row.mime,
        sizeBytes: Number(row.size_bytes),
        width: row.width,
        height: row.height,
        durationSec: row.duration_sec ? Number(row.duration_sec) : undefined,
        takenAt: row.taken_at ? row.taken_at.toISOString() : undefined,
        createdAt: row.created_at.toISOString(),
        isFavorite: Boolean(row.is_favorite),
        thumbUrl,
      };
    })
  );

  const thumbCount = items.filter((i) => !!i.thumbUrl).length;
  if (thumbCount > 0) {
    recordClassB(thumbCount).catch(() => {});
  }

  return { items };
}

export async function getMediaOriginalUrl(mediaId: string, asDownload = false) {
  const result = await pool.query(
    `SELECT id, object_key, thumb_key, mime, size_bytes, status
     FROM media
     WHERE id = $1 AND status = 'ready'`,
    [mediaId]
  );

  if (result.rows.length === 0) {
    throw new AppError(404, 'MEDIA_NOT_FOUND', 'Media tidak ditemukan.');
  }

  const media = result.rows[0];
  const filename = path.basename(media.object_key);
  const url = await r2Service.getPresignedGetUrl(
    media.object_key,
    3600,
    asDownload ? filename : undefined
  );

  let thumbUrl: string | undefined;
  if (media.thumb_key) {
    thumbUrl = await r2Service.getPresignedGetUrl(media.thumb_key, 3600);
  }

  recordClassB(media.thumb_key ? 2 : 1).catch(() => {});

  return {
    url,
    thumbUrl,
    mime: media.mime,
    sizeBytes: Number(media.size_bytes),
    filename,
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
  recordClassA(1).catch(() => {});

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
  if (matchedIds.length > 0) {
    recordClassA(matchedIds.length).catch(() => {});
  }

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

export async function toggleMediaFavorite(mediaId: string, forcedValue?: boolean) {
  let query: string;
  let params: any[];

  if (typeof forcedValue === 'boolean') {
    query = `
      UPDATE media
      SET is_favorite = $1
      WHERE id = $2 AND status = 'ready'
      RETURNING id, is_favorite
    `;
    params = [forcedValue, mediaId];
  } else {
    query = `
      UPDATE media
      SET is_favorite = NOT is_favorite
      WHERE id = $1 AND status = 'ready'
      RETURNING id, is_favorite
    `;
    params = [mediaId];
  }

  const result = await pool.query(query, params);
  if (result.rows.length === 0) {
    throw new AppError(404, 'MEDIA_NOT_FOUND', 'File kenangan tidak ditemukan');
  }

  return {
    id: result.rows[0].id,
    isFavorite: Boolean(result.rows[0].is_favorite),
  };
}

export async function batchSetFavorite(mediaIds: string[], isFavorite = true) {
  const result = await pool.query(
    `UPDATE media
     SET is_favorite = $1
     WHERE id = ANY($2::uuid[]) AND status = 'ready'
     RETURNING id, is_favorite`,
    [isFavorite, mediaIds]
  );

  return {
    updatedIds: result.rows.map((r) => r.id),
    isFavorite,
    count: result.rows.length,
  };
}

