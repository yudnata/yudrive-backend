import { pool } from '../src/config/db';
import { s3Client } from '../src/config/s3';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { env } from '../src/config/env';
import convert from 'heic-convert';
import sharp from 'sharp';

async function run() {
  console.log('Fetching HEIC media items from database...');
  const res = await pool.query(
    "SELECT id, object_key, thumb_key FROM media WHERE mime = 'image/heic' ORDER BY created_at DESC"
  );

  console.log(`Found ${res.rows.length} HEIC files to process.`);

  for (let i = 0; i < res.rows.length; i++) {
    const row = res.rows[i];
    console.log(`[${i + 1}/${res.rows.length}] Processing ${row.object_key}...`);
    try {
      const getRes = await s3Client.send(
        new GetObjectCommand({
          Bucket: env.R2_BUCKET,
          Key: row.object_key,
        })
      );
      const buf = Buffer.from(await (getRes.Body as any).transformToByteArray());
      const jpeg = await convert({ buffer: buf, format: 'JPEG', quality: 0.85 });
      const webpThumb = await sharp(Buffer.from(jpeg))
        .resize(400, 400, { fit: 'inside' })
        .rotate()
        .webp({ quality: 82 })
        .toBuffer();

      await s3Client.send(
        new PutObjectCommand({
          Bucket: env.R2_BUCKET,
          Key: row.thumb_key,
          Body: webpThumb,
          ContentType: 'image/webp',
        })
      );
      console.log(`  -> SUCCESS! Uploaded real thumbnail to ${row.thumb_key} (${webpThumb.length} bytes)`);
    } catch (err) {
      console.error(`  -> ERROR processing ${row.object_key}:`, err);
    }
  }

  console.log('All HEIC thumbnails processed!');
  process.exit(0);
}

run();
