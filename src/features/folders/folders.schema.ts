import { z } from 'zod';

export const createFolderSchema = z.object({
  name: z.string().trim().min(1, 'Nama folder tidak boleh kosong').max(100, 'Nama folder maksimal 100 karakter'),
  parentId: z.string().uuid().nullable().optional(),
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal harus YYYY-MM-DD').nullable().optional(),
});

export const updateFolderSchema = z.object({
  name: z.string().trim().min(1, 'Nama folder tidak boleh kosong').max(100, 'Nama folder maksimal 100 karakter').optional(),
  coverMediaId: z.string().uuid().nullable().optional(),
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal harus YYYY-MM-DD').nullable().optional(),
});

export const listFoldersQuerySchema = z.object({
  parentId: z.string().uuid().nullable().optional(),
  all: z.preprocess((val) => val === 'true' || val === true, z.boolean().optional()),
});

export type CreateFolderInput = z.infer<typeof createFolderSchema>;
export type UpdateFolderInput = z.infer<typeof updateFolderSchema>;
export type ListFoldersQuery = z.infer<typeof listFoldersQuerySchema>;
