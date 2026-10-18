import { z } from 'zod';

export const listMediaQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const mediaIdParamSchema = z.object({
  id: z.string().uuid('ID media tidak valid'),
});

export type ListMediaQuery = z.infer<typeof listMediaQuerySchema>;
