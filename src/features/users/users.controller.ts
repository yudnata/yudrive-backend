import { Request, Response, NextFunction } from 'express';
import { getMe, getAllUsers, getCloudflareUsage } from './users.service';

export async function handleGetMe(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user!.id;
    const data = await getMe(userId);
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

export async function handleGetR2Usage(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await getCloudflareUsage();
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

export async function handleGetAllUsers(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const users = await getAllUsers();
    res.status(200).json({ users });
  } catch (err) {
    next(err);
  }
}
