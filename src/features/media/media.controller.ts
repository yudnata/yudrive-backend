import { Request, Response, NextFunction } from 'express';
import {
  listMediaQuerySchema,
  mediaIdParamSchema,
} from './media.schema';
import {
  listMedia,
  getMediaOriginalUrl,
  deleteMedia,
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
