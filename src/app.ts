import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env';
import { healthRouter } from './features/health/health.router';
import { authRouter } from './features/auth/auth.router';
import { usersRouter } from './features/users/users.router';
import { uploadsRouter } from './features/uploads/uploads.router';
import { mediaRouter } from './features/media/media.router';
import { errorHandler, AppError } from './middleware/errorHandler';

export function createApp(): express.Application {
  const app = express();

  // Security headers
  app.use(helmet());

  // CORS configuration
  const allowedOrigins = env.CORS_ORIGIN.split(',').map((origin) => origin.trim());
  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow requests with no origin (e.g. mobile apps, curl, server-to-server)
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
          return callback(null, true);
        }
        return callback(new AppError(403, 'CORS_NOT_ALLOWED', 'Akses diblokir oleh kebijakan CORS.'));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    })
  );

  // Express only parses small JSON bodies (auth & metadata), never media streams
  app.use(express.json({ limit: '1mb' }));

  // Feature Routes
  app.use('/health', healthRouter);
  app.use('/auth', authRouter);
  app.use('/me', usersRouter);
  app.use('/uploads', uploadsRouter);
  app.use('/media', mediaRouter);

  // Fallback 404 handler
  app.use((_req: Request, _res: Response, next) => {
    next(new AppError(404, 'NOT_FOUND', 'Rute yang diminta tidak ditemukan.'));
  });

  // Global error handler
  app.use(errorHandler);

  return app;
}
