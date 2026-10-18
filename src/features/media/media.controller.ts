import { Request, Response, NextFunction } from 'express';
import {
  listMediaQuerySchema,
  mediaIdParamSchema,
  moveMediaSchema,
  batchDeleteSchema,
  batchMoveSchema,
  toggleFavoriteSchema,
  batchFavoriteSchema,
} from './media.schema';
import {
  listMedia,
  getRandomMedia,
  getMediaOriginalUrl,
  deleteMedia,
  moveMedia,
  batchDeleteMedia,
  batchMoveMedia,
  toggleMediaFavorite,
  batchSetFavorite,
} from './media.service';

export async function handleGetRandomMedia(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const limitPerFolder = Math.min(Math.max(Number(req.query.limitPerFolder) || 3, 1), 10);
    const totalLimit = Math.min(Math.max(Number(req.query.limit) || 50, 10), 100);
    const data = await getRandomMedia(limitPerFolder, totalLimit);
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

export async function handleListMedia(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parseResult = listMediaQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      const issue = parseResult.error.issues[0];
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: issue?.message || 'Parameter query tidak valid.',
        },
      });
      return;
    }

    const data = await listMedia(parseResult.data);
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

export async function handleGetMediaUrl(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parseResult = mediaIdParamSchema.safeParse(req.params);
    if (!parseResult.success) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Format ID media tidak valid.',
        },
      });
      return;
    }

    const asDownload = req.query.download === 'true';
    const data = await getMediaOriginalUrl(parseResult.data.id, asDownload);
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

export async function handleDeleteMedia(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parseResult = mediaIdParamSchema.safeParse(req.params);
    if (!parseResult.success) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Format ID media tidak valid.',
        },
      });
      return;
    }

    const userId = req.user!.id;
    const result = await deleteMedia(parseResult.data.id, userId);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function handleMoveMedia(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const paramResult = mediaIdParamSchema.safeParse(req.params);
    if (!paramResult.success) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Format ID media tidak valid.',
        },
      });
      return;
    }

    const bodyResult = moveMediaSchema.safeParse(req.body);
    if (!bodyResult.success) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: bodyResult.error.issues[0]?.message || 'Data pindah folder tidak valid.',
        },
      });
      return;
    }

    const userId = req.user!.id;
    const media = await moveMedia(paramResult.data.id, bodyResult.data.folderId, userId);
    res.status(200).json(media);
  } catch (err) {
    next(err);
  }
}

export async function handleBatchDelete(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parseResult = batchDeleteSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: parseResult.error.issues[0]?.message || 'Data batch delete tidak valid.',
        },
      });
      return;
    }

    const userId = req.user!.id;
    const result = await batchDeleteMedia(parseResult.data.ids, userId);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function handleBatchMove(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parseResult = batchMoveSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: parseResult.error.issues[0]?.message || 'Data batch move tidak valid.',
        },
      });
      return;
    }

    const userId = req.user!.id;
    const result = await batchMoveMedia(parseResult.data.ids, parseResult.data.folderId, userId);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function handleToggleFavorite(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const paramResult = mediaIdParamSchema.safeParse(req.params);
    if (!paramResult.success) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Format ID media tidak valid.',
        },
      });
      return;
    }

    const bodyResult = toggleFavoriteSchema.safeParse(req.body);
    const forcedValue = bodyResult.success ? bodyResult.data.isFavorite : undefined;

    const result = await toggleMediaFavorite(paramResult.data.id, forcedValue);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function handleBatchFavorite(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parseResult = batchFavoriteSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: parseResult.error.issues[0]?.message || 'Data batch favorite tidak valid.',
        },
      });
      return;
    }

    const isFavorite = parseResult.data.isFavorite !== undefined ? parseResult.data.isFavorite : true;
    const result = await batchSetFavorite(parseResult.data.ids, isFavorite);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

