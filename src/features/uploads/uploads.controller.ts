import { Request, Response, NextFunction } from 'express';
import {
  initUploadSchema,
  completeUploadSchema,
  abortUploadSchema,
} from './uploads.schema';
import {
  initUpload,
  completeUpload,
  abortUpload,
} from './uploads.service';

export async function handleInitUpload(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parseResult = initUploadSchema.safeParse(req.body);
    if (!parseResult.success) {
      const issue = parseResult.error.issues[0];
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: issue?.message || 'Data inisialisasi upload tidak valid.',
        },
      });
      return;
    }

    const userId = req.user!.id;
    const result = await initUpload(userId, parseResult.data);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function handleCompleteUpload(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parseResult = completeUploadSchema.safeParse(req.body);
    if (!parseResult.success) {
      const issue = parseResult.error.issues[0];
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: issue?.message || 'Data penyelesaian upload tidak valid.',
        },
      });
      return;
    }

    const userId = req.user!.id;
    const result = await completeUpload(userId, parseResult.data);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function handleAbortUpload(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parseResult = abortUploadSchema.safeParse(req.body);
    if (!parseResult.success) {
      const issue = parseResult.error.issues[0];
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: issue?.message || 'Data pembatalan upload tidak valid.',
        },
      });
      return;
    }

    const userId = req.user!.id;
    const result = await abortUpload(userId, parseResult.data);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}
