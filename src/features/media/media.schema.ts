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

export type ListMediaQuery = z.infer<typeof listMediaQuerySchema>;
export type MoveMediaInput = z.infer<typeof moveMediaSchema>;
