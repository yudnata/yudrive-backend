import crypto from 'crypto';
import path from 'path';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { pool } from '../../config/db';
import { env } from '../../config/env';
import { s3Client } from '../../config/s3';
import { AppError } from '../../middleware/errorHandler';
import { r2Service } from './r2.service';
import { getStorageUsage } from '../users/users.service';
import { getFolderCloudflarePath } from '../folders/folders.service';
import convert from 'heic-convert';
import sharp from 'sharp';
import {
  InitUploadInput,
  CompleteUploadInput,
  AbortUploadInput,
} from './uploads.schema';
import { recordClassA } from '../r2-usage/r2-usage.service';

const MULTIPART_THRESHOLD_BYTES = 50 * 1024 * 1024; // 50 MB
const PART_SIZE_BYTES = 16 * 1024 * 1024; // 16 MiB

export async function ensureThumbnail(objectKey: string, thumbKey: string, mime: string): Promise<boolean> {
  try {
    // 1. Check if thumbnail was already successfully uploaded by client
    try {
      await r2Service.headObject(thumbKey);
      return true; // Thumbnail already exists on R2
    } catch {
      // Thumbnail not present, proceed to server-side generation
    }

    const res = await s3Client.send(
      new GetObjectCommand({
        Bucket: env.R2_BUCKET,
        Key: objectKey,
      })
    );
    const buf = Buffer.from(await (res.Body as any).transformToByteArray());

    let webpThumb: Buffer;
    if (mime === 'image/heic' || objectKey.toLowerCase().endsWith('.heic')) {
      const jpeg = await convert({ buffer: buf, format: 'JPEG', quality: 0.85 });
      webpThumb = await sharp(Buffer.from(jpeg))
        .resize(400, 400, { fit: 'inside' })
        .rotate()
        .webp({ quality: 82 })
        .toBuffer();
    } else if (mime.startsWith('image/')) {
      webpThumb = await sharp(buf)
        .resize(400, 400, { fit: 'inside' })
        .rotate()
        .webp({ quality: 82 })
        .toBuffer();
    } else {
      return false;
    }

    await s3Client.send(
      new PutObjectCommand({
        Bucket: env.R2_BUCKET,
        Key: thumbKey,
        Body: webpThumb,
        ContentType: 'image/webp',
      })
    );
    return true;
  } catch (err) {
    console.warn(`ensureThumbnail error for ${objectKey}:`, err);
    return false;
  }
}

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

  let safeMime = input.mime;
  if (!safeMime || safeMime === 'application/octet-stream') {
    if (['mp4', 'mov', 'webm', 'm4v', 'avi', 'mkv'].includes(rawExt)) {
      safeMime = rawExt === 'mov' ? 'video/quicktime' : `video/${rawExt}`;
    } else if (['jpg', 'jpeg'].includes(rawExt)) {
      safeMime = 'image/jpeg';
    } else if (rawExt === 'png') {
      safeMime = 'image/png';
    } else if (rawExt === 'webp') {
      safeMime = 'image/webp';
    } else if (rawExt === 'heic') {
      safeMime = 'image/heic';
    } else {
      safeMime = 'image/jpeg';
    }
  }

  const ext = rawExt || (safeMime.startsWith('video/') ? 'mp4' : 'jpg');
  const type = safeMime.startsWith('video/') ? 'video' : 'photo';

  let safeTakenAt: Date | null = null;
  if (input.takenAt) {
    const d = new Date(input.takenAt);
    if (!isNaN(d.getTime())) {
      safeTakenAt = d;
    }
  }

  // Validate folder ID exists in DB to prevent foreign key violation
  let validFolderId: string | null = null;
  if (input.folderId) {
    const folderCheck = await pool.query(`SELECT id FROM folders WHERE id = $1`, [input.folderId]);
    if (folderCheck.rows.length > 0) {
      validFolderId = input.folderId;
    }
  }

  // Object keys in Cloudflare R2 matching folder structure:
  // folders/{folderName}/{mediaId}.{ext} or folders/utama/{mediaId}.{ext}
  const folderPrefix = await getFolderCloudflarePath(validFolderId);
  const objectKey = `${folderPrefix}/${mediaId}.${ext}`;
  const thumbKey = `t/${mediaId}.webp`;

  let mode: 'single' | 'multipart' = 'single';
  let uploadId: string | null = null;
  let uploadUrl: string | undefined;
  let parts: Array<{ partNumber: number; uploadUrl: string }> | undefined;

  // 4. Generate presigned URLs depending on size
  if (input.size <= MULTIPART_THRESHOLD_BYTES) {
    mode = 'single';
    uploadUrl = await r2Service.getPresignedPutUrl(objectKey, safeMime, 900);
  } else {
    mode = 'multipart';
    uploadId = await r2Service.createMultipartUpload(objectKey, safeMime);
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
      safeMime,
      input.size,
      input.width || null,
      input.height || null,
      input.duration || null,
      safeTakenAt,
      uploadId,
      validFolderId,
    ]
  );

  recordClassA(1).catch(() => {});

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
    `SELECT id, object_key, thumb_key, size_bytes, upload_id, status, mime
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

  // Ensure compressed WebP thumbnail exists on Cloudflare R2
  if (media.thumb_key) {
    ensureThumbnail(media.object_key, media.thumb_key, media.mime).catch((err) => {
      console.warn(`Failed server-side thumbnail check for ${media.id}:`, err);
    });
  }

  recordClassA(1).catch(() => {});

  // Fetch complete media row with joined user and folder details
  const mediaRes = await pool.query(
    `SELECT m.id, m.owner_id, m.type, m.object_key, m.thumb_key, m.mime, m.size_bytes,
            m.width, m.height, m.duration_sec, m.taken_at, m.created_at, m.folder_id,
            m.is_favorite,
            u.name AS owner_name, u.email AS owner_email,
            f.name AS folder_name
     FROM media m
     LEFT JOIN users u ON m.owner_id = u.id
     LEFT JOIN folders f ON m.folder_id = f.id
     WHERE m.id = $1`,
    [media.id]
  );

  let mediaItem = undefined;
  if (mediaRes.rows.length > 0) {
    const row = mediaRes.rows[0];
    let thumbUrl: string | undefined;
    if (row.thumb_key) {
      try {
        thumbUrl = await r2Service.getPresignedGetUrl(row.thumb_key, 3600);
      } catch (err) {
        console.error(`Failed to generate thumb presigned GET for ${row.id}:`, err);
      }
    }
    mediaItem = {
      id: row.id,
      ownerId: row.owner_id,
      ownerName: row.owner_name || undefined,
      ownerEmail: row.owner_email || undefined,
      folderId: row.folder_id || undefined,
      folderName: row.folder_name || undefined,
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
  }

  return {
    success: true,
    mediaId: media.id,
    status: 'ready',
    media: mediaItem,
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
