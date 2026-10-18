import { Request, Response, NextFunction } from 'express';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
      },
    });
    return;
  }

  // Hide internal server error details in production to prevent data leaks
  const isProduction = process.env.NODE_ENV === 'production';
  res.status(500).json({
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: isProduction
        ? 'Terjadi kesalahan pada server. Silakan coba lagi.'
        : err.message || 'Internal server error',
    },
  });
}
