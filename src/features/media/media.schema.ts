import { z } from 'zod';

export const listMediaQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  folderId: z.string().optional(),
  favorite: z.preprocess((val) => val === 'true' || val === true, z.boolean()).optional(),
  search: z.string().optional(),
  type: z.enum(['all', 'photo', 'video']).optional(),
  author: z.string().optional(),
  sortBy: z.enum(['date-desc', 'date-asc', 'name-asc', 'name-desc', 'size-desc', 'size-asc']).optional(),
});

export const mediaIdParamSchema = z.object({
  id: z.string().uuid('ID media tidak valid'),
});

export const toggleFavoriteSchema = z.object({
  isFavorite: z.boolean().optional(),
});

export const batchFavoriteSchema = z.object({
  ids: z.array(z.string().uuid()).min(1, 'Pilih minimal satu file untuk favorit'),
  isFavorite: z.boolean().optional(),
});

export const moveMediaSchema = z.object({
  folderId: z.string().uuid('ID folder tidak valid').nullable().optional(),
});

export const batchDeleteSchema = z.object({
  ids: z.array(z.string().uuid()).min(1, 'Pilih minimal satu file untuk dihapus'),
});

export const batchMoveSchema = z.object({
  ids: z.array(z.string().uuid()).min(1, 'Pilih minimal satu file untuk dipindahkan'),
  folderId: z.string().uuid('ID folder tidak valid').nullable().optional(),
});

export type ListMediaQuery = z.infer<typeof listMediaQuerySchema>;
export type MoveMediaInput = z.infer<typeof moveMediaSchema>;
export type BatchDeleteInput = z.infer<typeof batchDeleteSchema>;
export type BatchMoveInput = z.infer<typeof batchMoveSchema>;
export type ToggleFavoriteInput = z.infer<typeof toggleFavoriteSchema>;
export type BatchFavoriteInput = z.infer<typeof batchFavoriteSchema>;
