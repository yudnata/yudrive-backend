import { z } from 'zod';

export const initUploadSchema = z.object({
  filename: z.string().min(1, 'Nama file wajib diisi'),
  mime: z.string().refine(
    (m) => m.startsWith('image/') || m.startsWith('video/'),
    'Hanya file foto atau video yang diperbolehkan'
  ),
  size: z.number().int().positive('Ukuran file harus lebih dari 0 byte'),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  duration: z.number().nonnegative().optional(),
  takenAt: z.string().datetime().optional(),
  folderId: z.string().uuid().nullable().optional(),
});

export const completeUploadSchema = z.object({
  mediaId: z.string().uuid('ID media tidak valid'),
  parts: z
    .array(
      z.object({
        partNumber: z.number().int().positive(),
        etag: z.string().min(1, 'ETag wajib disertakan'),
      })
    )
    .optional(),
});

export const abortUploadSchema = z.object({
  mediaId: z.string().uuid('ID media tidak valid'),
});

export type InitUploadInput = z.infer<typeof initUploadSchema>;
export type CompleteUploadInput = z.infer<typeof completeUploadSchema>;
export type AbortUploadInput = z.infer<typeof abortUploadSchema>;
