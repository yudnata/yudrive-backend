import crypto from 'crypto';
import path from 'path';
import { pool } from '../../config/db';
import { env } from '../../config/env';
import { AppError } from '../../middleware/errorHandler';
import { r2Service } from './r2.service';
import { getStorageUsage } from '../users/users.service';
import { getFolderCloudflarePath } from '../folders/folders.service';
import {
  InitUploadInput,
  CompleteUploadInput,
  AbortUploadInput,
} from './uploads.schema';

const MULTIPART_THRESHOLD_BYTES = 50 * 1024 * 1024; // 50 MB
const PART_SIZE_BYTES = 16 * 1024 * 1024; // 16 MiB

export async function initUpload(userId: string, input: InitUploadInput) {
  // 1. Validate max file limit
  if (input.size > env.MAX_FILE_BYTES) {
    throw new AppError(
      400,
      'FILE_TOO_LARGE',
      `Ukuran file melebihi batas maksimum (${Math.round(env.MAX_FILE_BYTES / (1024 * 1024 * 1024))} GB).`
    );
  }

  // 2. Validate storage quota guard
  const usage = await getStorageUsage();
  if (usage.usedBytes + input.size > env.QUOTA_BYTES) {
    throw new AppError(
      400,
      'QUOTA_EXCEEDED',
      'Penyimpanan tidak mencukupi untuk file ini (Batas kuota 9 GB).'
    );
  }

  // 3. Prepare media metadata
  const mediaId = crypto.randomUUID();
  const rawExt = path.extname(input.filename).replace('.', '').toLowerCase();
  const ext = rawExt || (input.mime.startsWith('video/') ? 'mp4' : 'jpg');
  const type = input.mime.startsWith('video/') ? 'video' : 'photo';

  const takenAtDate = input.takenAt ? new Date(input.takenAt) : new Date();
  const year = takenAtDate.getFullYear();

  // Object keys in Cloudflare R2 matching folder structure:
  // folders/{folderName}/{mediaId}.{ext} or folders/utama/{mediaId}.{ext}
  const folderPrefix = await getFolderCloudflarePath(input.folderId);
  const objectKey = `${folderPrefix}/${mediaId}.${ext}`;
  const thumbKey = `t/${mediaId}.webp`;

  let mode: 'single' | 'multipart' = 'single';
  let uploadId: string | null = null;
  let uploadUrl: string | undefined;
  let parts: Array<{ partNumber: number; uploadUrl: string }> | undefined;

  // 4. Generate presigned URLs depending on size
  if (input.size <= MULTIPART_THRESHOLD_BYTES) {
    mode = 'single';
    uploadUrl = await r2Service.getPresignedPutUrl(objectKey, input.mime, 900);
  } else {
    mode = 'multipart';
    uploadId = await r2Service.createMultipartUpload(objectKey, input.mime);
    const totalParts = Math.ceil(input.size / PART_SIZE_BYTES);

    parts = await Promise.all(
      Array.from({ length: totalParts }, async (_, i) => {
        const partNumber = i + 1;
        const partUrl = await r2Service.getPresignedUploadPartUrl(
          objectKey,
          uploadId!,
          partNumber,
          900
        );
        return { partNumber, uploadUrl: partUrl };
      })
    );
  }

  // Presigned PUT URL for thumbnail
  const thumbUploadUrl = await r2Service.getPresignedPutUrl(
    thumbKey,
    'image/webp',
    900
  );

  // 5. Store pending row in Postgres
  await pool.query(
    `INSERT INTO media (
      id, owner_id, type, object_key, thumb_key, mime, size_bytes,
      width, height, duration_sec, taken_at, status, upload_id, folder_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending', $12, $13)`,
    [
      mediaId,
      userId,
      type,
      objectKey,
      thumbKey,
      input.mime,
      input.size,
      input.width || null,
      input.height || null,
      input.duration || null,
      input.takenAt ? new Date(input.takenAt) : null,
      uploadId,
      input.folderId || null,
    ]
  );

  return {
    mediaId,
    mode,
    objectKey,
    thumbKey,
    uploadUrl,
    thumbUploadUrl,
    uploadId: uploadId || undefined,
    partSize: mode === 'multipart' ? PART_SIZE_BYTES : undefined,
    parts,
  };
}

export async function completeUpload(userId: string, input: CompleteUploadInput) {
  const result = await pool.query(
    `SELECT id, object_key, thumb_key, size_bytes, upload_id, status
     FROM media
     WHERE id = $1 AND owner_id = $2`,
    [input.mediaId, userId]
  );

  if (result.rows.length === 0) {
    throw new AppError(404, 'MEDIA_NOT_FOUND', 'Media tidak ditemukan.');
  }

  const media = result.rows[0];
  if (media.status === 'ready') {
    return { success: true, mediaId: media.id, status: 'ready' };
  }

  // Complete multipart if applicable
  if (media.upload_id) {
    if (!input.parts || input.parts.length === 0) {
      throw new AppError(
        400,
        'PARTS_REQUIRED',
        'Daftar part dan ETag diperlukan untuk menyelesaikan multipart upload.'
      );
    }

    await r2Service.completeMultipartUpload(
      media.object_key,
      media.upload_id,
      input.parts.map((p) => ({
        PartNumber: p.partNumber,
        ETag: p.etag,
      }))
    );
  }

  // Verify object existence and size on R2
  const head = await r2Service.headObject(media.object_key);
  const expectedBytes = Number(media.size_bytes);

  if (head.sizeBytes !== expectedBytes) {
    throw new AppError(
      400,
      'SIZE_MISMATCH',
      `Ukuran file di storage (${head.sizeBytes} bytes) tidak sesuai dengan yang diharapkan (${expectedBytes} bytes).`
    );
  }

  // Update status to ready
  await pool.query(
    `UPDATE media
     SET status = 'ready', upload_id = NULL
     WHERE id = $1`,
    [media.id]
  );

  return {
    success: true,
    mediaId: media.id,
    status: 'ready',
  };
}

export async function abortUpload(userId: string, input: AbortUploadInput) {
  const result = await pool.query(
    `SELECT id, object_key, thumb_key, upload_id, status
     FROM media
     WHERE id = $1 AND owner_id = $2`,
    [input.mediaId, userId]
  );

  if (result.rows.length === 0) {
    return { success: true };
  }

  const media = result.rows[0];
  if (media.status === 'pending') {
    if (media.upload_id) {
      await r2Service.abortMultipartUpload(media.object_key, media.upload_id).catch(() => {});
    }
    await r2Service.deleteObject(media.object_key).catch(() => {});
    if (media.thumb_key) {
      await r2Service.deleteObject(media.thumb_key).catch(() => {});
    }
    await pool.query('DELETE FROM media WHERE id = $1', [media.id]);
  }

  return { success: true };
}

// Background cleanup for abandoned uploads older than 24 hours
export async function cleanupStalePendingMedia(): Promise<number> {
  const staleResult = await pool.query(
    `SELECT id, object_key, thumb_key, upload_id
     FROM media
     WHERE status = 'pending' AND created_at < NOW() - INTERVAL '24 hours'
     LIMIT 50`
  );

  let cleaned = 0;
  for (const row of staleResult.rows) {
    try {
      if (row.upload_id) {
        await r2Service.abortMultipartUpload(row.object_key, row.upload_id).catch(() => {});
      }
      await r2Service.deleteObject(row.object_key).catch(() => {});
      if (row.thumb_key) {
        await r2Service.deleteObject(row.thumb_key).catch(() => {});
      }
      await pool.query('DELETE FROM media WHERE id = $1', [row.id]);
      cleaned++;
    } catch (err) {
      console.error(`Failed to clean stale upload ${row.id}:`, err);
    }
  }

  return cleaned;
}
