# Our Memories - Backend API

Backend Express + TypeScript untuk aplikasi privat Our Memories.

## Fitur Utama
- Endpoint `/health` untuk liveness probe Azure App Service F1.
- Autentikasi JWT privat untuk 2 akun (tanpa registrasi publik).
- Pembuatan presigned URL S3 untuk Cloudflare R2 (PUT single/multipart & GET).
- Database migration via `node-pg-migrate` untuk PostgreSQL Neon.
- Proteksi keamanan: `helmet`, `cors`, `express-rate-limit`, hash `argon2`.

## Cara Menjalankan Lokal

1. Salin konfigurasi environment:
   ```bash
   cp .env.example .env
   ```
2. Pasang dependensi:
   ```bash
   npm install
   ```
3. Jalankan server development:
   ```bash
   npm run dev
   ```
4. Build untuk production:
   ```bash
   npm run build
   npm start
   ```

## Endpoint Health Check
- `GET /health` -> `200 OK`
