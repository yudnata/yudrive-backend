import { Request, Response, NextFunction } from 'express';
import {
  listMediaQuerySchema,
  mediaIdParamSchema,
  moveMediaSchema,
} from './media.schema';
import {
  listMedia,
  getMediaOriginalUrl,
  deleteMedia,
  moveMedia,
} from './media.service';

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

    const data = await getMediaOriginalUrl(parseResult.data.id);
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
