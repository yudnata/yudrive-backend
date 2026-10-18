# Panduan Setup Cloudflare R2 (Biaya Rp0)

Cloudflare R2 menyediakan kuota gratis 10 GB storage per bulan dan egress (download) tak terbatas tanpa biaya.

---

## 1. Buat Bucket R2
1. Masuk ke **Cloudflare Dashboard** -> **R2** -> **Overview**.
2. Klik **Create bucket**.
3. Beri nama bucket: `our-memories` (atau sesuaikan dengan nilai `R2_BUCKET`).
4. Location Hint: Pilih **Automatic** (atau Western Europe / North America / Asia Pacific terdekat).
5. Klik **Create Bucket**.

---

## 2. Buat API Token (Scoped ke Bucket)
1. Di halaman **R2 Overview**, klik **Manage R2 API Tokens** di panel kanan.
2. Klik **Create API token**.
3. Isi konfigurasi:
   - **Token name**: `our-memories-api-token`
   - **Permissions**: Pilih **Object Read & Write**
   - **Apply to specific buckets only**: Pilih bucket `our-memories`
   - **TTL**: Sesuaikan atau biarkan default
4. Klik **Create API Token**.
5. Salin nilai berikut ke `.env` pada server/Azure:
   - `R2_ACCOUNT_ID`: Account ID Cloudflare (tertera di URL atau halaman R2)
   - `R2_ACCESS_KEY_ID`: Access Key ID yang baru dibuat
   - `R2_SECRET_ACCESS_KEY`: Secret Access Key yang baru dibuat

---

## 3. Konfigurasi CORS (Wajib)
CORS wajib dikonfigurasi agar browser bisa upload langsung via Presigned PUT dan membaca header `ETag` (tanpa `ETag`, multipart upload browser gagal).

### Opsi A: Lewat Cloudflare Dashboard
1. Buka bucket `our-memories` -> tab **Settings**.
2. Gulir ke bawah ke bagian **CORS Policy** -> klik **Add CORS policy**.
3. Masukkan JSON dari file `scripts/r2-cors.json` (pastikan ganti `https://*.vercel.app` dengan domain Vercel spesifik Anda setelah deploy).
4. Klik **Save**.

### Opsi B: Lewat AWS CLI
```bash
aws s3api put-bucket-cors \
  --bucket our-memories \
  --endpoint-url https://<ACCOUNT_ID>.r2.cloudflarestorage.com \
  --cors-configuration file://scripts/r2-cors.json
```

---

## 4. Konfigurasi Lifecycle Rule (Abort Multipart Menggantung)
Untuk mencegah part upload gagal yang tidak selesai memakan kuota 10 GB:

### Opsi A: Lewat Cloudflare Dashboard
1. Buka bucket `our-memories` -> tab **Settings**.
2. Cari bagian **Lifecycle Rules** / **Object Lifecycle Rules**.
3. Tambahkan aturan untuk membatalkan incomplete multipart upload setelah 7 hari.

### Opsi B: Lewat AWS CLI
```bash
aws s3api put-bucket-lifecycle-configuration \
  --bucket our-memories \
  --endpoint-url https://<ACCOUNT_ID>.r2.cloudflarestorage.com \
  --lifecycle-configuration file://scripts/r2-lifecycle.json
```
