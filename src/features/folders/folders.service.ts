import { pool } from '../../config/db';
import { AppError } from '../../middleware/errorHandler';
import { r2Service } from '../uploads/r2.service';
import { CreateFolderInput, UpdateFolderInput } from './folders.schema';

export async function createFolder(userId: string, input: CreateFolderInput) {
  const result = await pool.query(
    `INSERT INTO folders (owner_id, name, parent_id)
     VALUES ($1, $2, $3)
     RETURNING id, owner_id, name, parent_id, cover_media_id, created_at, updated_at`,
    [userId, input.name, input.parentId || null]
  );
  return {
    ...result.rows[0],
    itemCount: 0,
    totalBytes: 0,
    coverUrl: null,
  };
}

export async function listFolders(parentId?: string | null) {
  const result = await pool.query(
    `SELECT f.id, f.owner_id, f.name, f.parent_id, f.cover_media_id, f.created_at, f.updated_at,
            COUNT(m.id)::int AS item_count,
            COALESCE(SUM(m.size_bytes), 0)::bigint AS total_bytes,
            cov.thumb_key AS cover_thumb_key,
            MAX(m.thumb_key) AS fallback_thumb_key
     FROM folders f
     LEFT JOIN media m ON m.folder_id = f.id AND m.status = 'ready'
     LEFT JOIN media cov ON cov.id = f.cover_media_id AND cov.status = 'ready'
     WHERE ($1::uuid IS NULL AND f.parent_id IS NULL) OR (f.parent_id = $1::uuid)
     GROUP BY f.id, f.owner_id, f.name, f.parent_id, f.cover_media_id, f.created_at, f.updated_at, cov.thumb_key
     ORDER BY f.name ASC`,
    [parentId || null]
  );

  const folders = await Promise.all(
    result.rows.map(async (row) => {
      let coverUrl: string | null = null;
      const thumbKey = row.cover_thumb_key || row.fallback_thumb_key;
      if (thumbKey) {
        try {
          coverUrl = await r2Service.getPresignedGetUrl(thumbKey, 3600);
        } catch (err) {
          console.error(`Failed to sign cover URL for folder ${row.id}:`, err);
        }
      }
      return {
        id: row.id,
        ownerId: row.owner_id,
        name: row.name,
        parentId: row.parent_id,
        coverMediaId: row.cover_media_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        itemCount: row.item_count,
        totalBytes: Number(row.total_bytes),
        coverUrl,
      };
    })
  );

  return folders;
}

export async function getFolder(folderId: string) {
  const result = await pool.query(
    `SELECT f.id, f.owner_id, f.name, f.parent_id, f.cover_media_id, f.created_at, f.updated_at,
            COUNT(m.id)::int AS item_count,
            COALESCE(SUM(m.size_bytes), 0)::bigint AS total_bytes,
            cov.thumb_key AS cover_thumb_key,
            MAX(m.thumb_key) AS fallback_thumb_key
     FROM folders f
     LEFT JOIN media m ON m.folder_id = f.id AND m.status = 'ready'
     LEFT JOIN media cov ON cov.id = f.cover_media_id AND cov.status = 'ready'
     WHERE f.id = $1
     GROUP BY f.id, f.owner_id, f.name, f.parent_id, f.cover_media_id, f.created_at, f.updated_at, cov.thumb_key`,
    [folderId]
  );

  if (result.rows.length === 0) {
    throw new AppError(404, 'FOLDER_NOT_FOUND', 'Folder tidak ditemukan.');
  }

  const row = result.rows[0];
  let coverUrl: string | null = null;
  const thumbKey = row.cover_thumb_key || row.fallback_thumb_key;
  if (thumbKey) {
    try {
      coverUrl = await r2Service.getPresignedGetUrl(thumbKey, 3600);
    } catch (err) {
      console.error(`Failed to sign cover URL for folder ${row.id}:`, err);
    }
  }

  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    parentId: row.parent_id,
    coverMediaId: row.cover_media_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    itemCount: row.item_count,
    totalBytes: Number(row.total_bytes),
    coverUrl,
  };
}

export async function updateFolder(folderId: string, input: UpdateFolderInput) {
  const existing = await pool.query(`SELECT id FROM folders WHERE id = $1`, [folderId]);
  if (existing.rows.length === 0) {
    throw new AppError(404, 'FOLDER_NOT_FOUND', 'Folder tidak ditemukan.');
  }

  const updates: string[] = ['updated_at = now()'];
  const params: any[] = [folderId];

  if (input.name !== undefined) {
    params.push(input.name);
    updates.push(`name = $${params.length}`);
  }

  if (input.coverMediaId !== undefined) {
    params.push(input.coverMediaId);
    updates.push(`cover_media_id = $${params.length}`);
  }

  await pool.query(
    `UPDATE folders SET ${updates.join(', ')} WHERE id = $1`,
    params
  );

  return getFolder(folderId);
}

export async function deleteFolder(folderId: string) {
  const existing = await pool.query(`SELECT id FROM folders WHERE id = $1`, [folderId]);
  if (existing.rows.length === 0) {
    throw new AppError(404, 'FOLDER_NOT_FOUND', 'Folder tidak ditemukan.');
  }

  // Deleting folder sets media.folder_id to null automatically (via ON DELETE SET NULL)
  await pool.query(`DELETE FROM folders WHERE id = $1`, [folderId]);
  return { success: true };
}
