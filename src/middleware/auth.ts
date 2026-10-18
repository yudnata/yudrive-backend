import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { AppError } from './errorHandler';
import { AuthUser } from '../types/express';

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(
      new AppError(401, 'UNAUTHORIZED', 'Token autentikasi tidak ditemukan atau tidak valid.')
    );
  }

  const token = authHeader.substring(7).trim();
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as AuthUser;
    req.user = decoded;
    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      return next(new AppError(401, 'TOKEN_EXPIRED', 'Sesi telah kedaluwarsa. Silakan masuk kembali.'));
    }
    return next(new AppError(401, 'INVALID_TOKEN', 'Token tidak valid.'));
  }
}
