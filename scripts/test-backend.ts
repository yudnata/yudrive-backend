import { newDb } from 'pg-mem';
import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app';
import { pool } from '../src/config/db';
import { env } from '../src/config/env';
import { r2Service } from '../src/features/uploads/r2.service';
import { s3Client } from '../src/config/s3';

async function runIntegrationTests() {
  console.log('--- STARTING BACKEND INTEGRATION TEST SUITE ---');

  // 1. Setup in-memory PostgreSQL
  const db = newDb();
  db.public.registerFunction({
    name: 'gen_random_uuid',
    impure: true,
    implementation: () => require('crypto').randomUUID(),
  });

  // Apply schema
  db.public.none(`
    CREATE TABLE users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE folders (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      parent_id UUID,
      cover_media_id UUID,
      event_date DATE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE media (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK (type IN ('photo', 'video')),
      object_key TEXT NOT NULL UNIQUE,
      thumb_key TEXT,
      mime TEXT NOT NULL,
      size_bytes BIGINT NOT NULL,
      width INT,
      height INT,
      duration_sec NUMERIC,
      taken_at TIMESTAMPTZ,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready')),
      upload_id TEXT,
      folder_id UUID,
      is_favorite BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE r2_usage_metrics (
      id SERIAL PRIMARY KEY,
      period_start TIMESTAMPTZ NOT NULL,
      period_end TIMESTAMPTZ NOT NULL,
      class_a_requests BIGINT NOT NULL DEFAULT 0,
      class_b_requests BIGINT NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    INSERT INTO r2_usage_metrics (id, period_start, period_end, class_a_requests, class_b_requests)
    VALUES (1, now(), now(), 0, 0);

    CREATE INDEX idx_media_status_taken_id ON media (status, taken_at DESC, id);
  `);

  // Seed 2 users
  const pwd1 = 'PartnerOnePassword123';
  const pwd2 = 'PartnerTwoPassword456';
  const hash1 = await argon2.hash(pwd1);
  const hash2 = await argon2.hash(pwd2);

  const user1 = db.public.one(
    `INSERT INTO users (email, name, password_hash)
     VALUES ('partner1@ourmemories.local', 'Partner 1', '${hash1}')
     RETURNING id, email, name`
  );

  const user2 = db.public.one(
    `INSERT INTO users (email, name, password_hash)
     VALUES ('partner2@ourmemories.local', 'Partner 2', '${hash2}')
     RETURNING id, email, name`
  );

  console.log('Seeded test users:', user1.email, user2.email);

  // Bind pg-mem adapter to pool.query
  const pgMemAdapter = db.adapters.createPg();
  const memClient = new pgMemAdapter.Client();
  await memClient.connect();

  pool.query = async (text: any, params?: any[]) => {
    return memClient.query(text, params);
  };

  // Mock R2 Service calls for local offline verification
  r2Service.getPresignedPutUrl = async (key: string) => `https://mock-r2.cloudflarestorage.com/put/${key}?signature=mock`;
  r2Service.getPresignedGetUrl = async (key: string) => `https://mock-r2.cloudflarestorage.com/get/${key}?signature=mock`;
  r2Service.createMultipartUpload = async () => 'mock-upload-id-999';
  r2Service.getPresignedUploadPartUrl = async (key: string, uploadId: string, partNumber: number) =>
    `https://mock-r2.cloudflarestorage.com/part/${key}?uploadId=${uploadId}&partNumber=${partNumber}`;
  r2Service.completeMultipartUpload = async () => {};
  r2Service.abortMultipartUpload = async () => {};
  r2Service.deleteObject = async () => {};
  s3Client.send = (async () => ({})) as any;
  r2Service.headObject = async (key: string) => {
    try {
      const row = db.public.one(`SELECT size_bytes FROM media WHERE object_key = '${key}' OR thumb_key = '${key}'`);
      return { sizeBytes: Number(row.size_bytes), mime: 'image/jpeg' };
    } catch {
      return { sizeBytes: 1024, mime: 'image/jpeg' };
    }
  };

  // Start express test server
  const app = createApp();
  const server = app.listen(0);
  const port = (server.address() as any).port;
  const baseUrl = `http://localhost:${port}`;

  let passed = 0;
  let failed = 0;

  async function assert(name: string, condition: boolean, detail?: string) {
    if (condition) {
      console.log(`[PASS] ${name}`);
      passed++;
    } else {
      console.error(`[FAIL] ${name} ${detail ? `- ${detail}` : ''}`);
      failed++;
    }
  }

  try {
    // Test 1: GET /health
    const healthRes = await fetch(`${baseUrl}/health`);
    const healthData = await healthRes.json();
    assert('GET /health returns 200 OK', healthRes.status === 200 && healthData.status === 'ok');

    // Test 2: POST /auth/login with invalid password
    const badLoginRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'partner1@ourmemories.local', password: 'wrongpassword' }),
    });
    assert('POST /auth/login with wrong password returns 401', badLoginRes.status === 401);

    // Test 3: POST /auth/login with valid password
    const loginRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'partner1@ourmemories.local', password: pwd1 }),
    });
    const loginData = await loginRes.json();
    assert('POST /auth/login with valid password returns 200 and JWT', loginRes.status === 200 && !!loginData.token);
    const token1 = loginData.token;

    // Login user 2
    const loginRes2 = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'partner2@ourmemories.local', password: pwd2 }),
    });
    const loginData2 = await loginRes2.json();
    const token2 = loginData2.token;

    // Test 4: GET /me without token
    const unauthMe = await fetch(`${baseUrl}/me`);
    assert('GET /me without token returns 401', unauthMe.status === 401);

    // Test 5: GET /me with token
    const authMe = await fetch(`${baseUrl}/me`, {
      headers: { Authorization: `Bearer ${token1}` },
    });
    const meData = await authMe.json();
    assert(
      'GET /me returns user profile and storage quota',
      authMe.status === 200 && meData.user.email === 'partner1@ourmemories.local' && meData.usage.quotaBytes > 0
    );

    // Test 6: POST /uploads/init (single mode <= 50 MB)
    const initSingleRes = await fetch(`${baseUrl}/uploads/init`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token1}`,
      },
      body: JSON.stringify({
        filename: 'trip_bali_2026.jpg',
        mime: 'image/jpeg',
        size: 5 * 1024 * 1024, // 5 MB
        width: 1920,
        height: 1080,
        takenAt: '2026-06-15T10:30:00Z',
      }),
    });
    const singleData = await initSingleRes.json();
    assert(
      'POST /uploads/init single mode returns presigned PUT URLs',
      initSingleRes.status === 200 &&
        singleData.mode === 'single' &&
        !!singleData.uploadUrl &&
        !!singleData.thumbUploadUrl
    );
    const photoMediaId = singleData.mediaId;

    // Test 7: POST /uploads/init (multipart mode > 50 MB)
    const initMultiRes = await fetch(`${baseUrl}/uploads/init`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token1}`,
      },
      body: JSON.stringify({
        filename: 'vacation_video.mp4',
        mime: 'video/mp4',
        size: 80 * 1024 * 1024, // 80 MB (5 parts of 16MB)
        duration: 120,
      }),
    });
    const multiData = await initMultiRes.json();
    assert(
      'POST /uploads/init multipart mode returns parts array and uploadId',
      initMultiRes.status === 200 &&
        multiData.mode === 'multipart' &&
        multiData.parts.length === 5 &&
        !!multiData.uploadId
    );

    // Test 8: Quota guard rejection
    const overQuotaRes = await fetch(`${baseUrl}/uploads/init`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token1}`,
      },
      body: JSON.stringify({
        filename: 'huge_backup.mp4',
        mime: 'video/mp4',
        size: 10 * 1024 * 1024 * 1024, // 10 GB (exceeds 9 GB quota)
      }),
    });
    assert('POST /uploads/init rejects file exceeding quota with 400', overQuotaRes.status === 400);

    // Test 9: Complete single upload
    const completeRes = await fetch(`${baseUrl}/uploads/complete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token1}`,
      },
      body: JSON.stringify({
        mediaId: photoMediaId,
      }),
    });
    const completeData = await completeRes.json();
    assert(
      'POST /uploads/complete sets media to ready',
      completeRes.status === 200 && completeData.status === 'ready'
    );

    // Test 10: GET /media (lists ready items)
    const mediaListRes = await fetch(`${baseUrl}/media?limit=10`, {
      headers: { Authorization: `Bearer ${token1}` },
    });
    const mediaListData = await mediaListRes.json();
    assert(
      'GET /media returns ready items with thumbnail presigned URLs',
      mediaListRes.status === 200 &&
        mediaListData.items.length === 1 &&
        mediaListData.items[0].id === photoMediaId &&
        !!mediaListData.items[0].thumbUrl
    );

    // Test 11: GET /media/:id/url
    const mediaUrlRes = await fetch(`${baseUrl}/media/${photoMediaId}/url`, {
      headers: { Authorization: `Bearer ${token2}` }, // partner 2 can view partner 1's photo
    });
    const mediaUrlData = await mediaUrlRes.json();
    assert(
      'GET /media/:id/url returns presigned original URL for partners',
      mediaUrlRes.status === 200 && !!mediaUrlData.url && mediaUrlData.mime === 'image/jpeg'
    );

    // Test 12: DELETE /media/:id by non-owner (Partner 2 attempts to delete Partner 1's upload)
    const forbiddenDeleteRes = await fetch(`${baseUrl}/media/${photoMediaId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token2}` },
    });
    assert('DELETE /media/:id by non-owner returns 403 Forbidden', forbiddenDeleteRes.status === 403);

    // Test 13: DELETE /media/:id by owner (Partner 1)
    const ownerDeleteRes = await fetch(`${baseUrl}/media/${photoMediaId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token1}` },
    });
    assert('DELETE /media/:id by owner returns 200 Success', ownerDeleteRes.status === 200);

    // Verify deleted
    const verifyListRes = await fetch(`${baseUrl}/media`, {
      headers: { Authorization: `Bearer ${token1}` },
    });
    const verifyListData = await verifyListRes.json();
    // Test 14: Rate limit on /auth/login (5 requests / min limit)
    // We already made 3 login requests (1 bad, 2 good). Send 2 more to hit limit.
    await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'partner1@ourmemories.local', password: 'dummy' }),
    });
    await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'partner1@ourmemories.local', password: 'dummy' }),
    });

    // 6th request must trigger HTTP 429
    const rateLimitedRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'partner1@ourmemories.local', password: 'dummy' }),
    });
    const rateLimitData = await rateLimitedRes.json();
    assert(
      'Rate limit blocks 6th login attempt with 429 RATE_LIMIT_EXCEEDED',
      rateLimitedRes.status === 429 && rateLimitData?.error?.code === 'RATE_LIMIT_EXCEEDED'
    );

    // Test 15: POST /folders (Create folder)
    const createFolderRes = await fetch(`${baseUrl}/folders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token1}`,
      },
      body: JSON.stringify({ name: 'Liburan Bali' }),
    });
    const folderData = await createFolderRes.json();
    assert(
      'POST /folders creates folder successfully',
      createFolderRes.status === 201 && folderData.name === 'Liburan Bali' && !!folderData.id
    );
    const testFolderId = folderData.id;

    // Test 16: GET /folders (List folders)
    const listFoldersRes = await fetch(`${baseUrl}/folders`, {
      headers: { Authorization: `Bearer ${token2}` },
    });
    const listFoldersData = await listFoldersRes.json();
    if (listFoldersRes.status !== 200) {
      console.error('GET /folders failed with:', listFoldersRes.status, listFoldersData);
    }
    assert(
      'GET /folders returns folder list for partners',
      listFoldersRes.status === 200 &&
        Array.isArray(listFoldersData.folders) &&
        listFoldersData.folders.some((f: any) => f.id === testFolderId)
    );

    // Test 17: PATCH /folders/:id (Update folder name)
    const updateFolderRes = await fetch(`${baseUrl}/folders/${testFolderId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token1}`,
      },
      body: JSON.stringify({ name: 'Liburan Bali 2026' }),
    });
    const updatedFolderData = await updateFolderRes.json();
    assert(
      'PATCH /folders/:id updates folder name',
      updateFolderRes.status === 200 && updatedFolderData.name === 'Liburan Bali 2026'
    );

    // Test 18: DELETE /folders/:id
    const deleteFolderRes = await fetch(`${baseUrl}/folders/${testFolderId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token1}` },
    });
    assert('DELETE /folders/:id deletes folder successfully', deleteFolderRes.status === 200);

    // Summary
    console.log(`\n--- TEST RESULTS: ${passed} PASSED, ${failed} FAILED ---`);
    if (failed > 0) {
      process.exit(1);
    }
  } finally {
    server.close();
    await memClient.end();
  }
}

runIntegrationTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
