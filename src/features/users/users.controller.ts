import { Request, Response, NextFunction } from 'express';
import { getMe } from './users.service';

export async function handleGetMe(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user!.id;
    const data = await getMe(userId);
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}
