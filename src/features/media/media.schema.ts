import { z } from 'zod';

export const listMediaQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  folderId: z.string().optional(),
});

export const mediaIdParamSchema = z.object({
  id: z.string().uuid('ID media tidak valid'),
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
