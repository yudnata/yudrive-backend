import { Request, Response, NextFunction } from 'express';
import { loginSchema } from './auth.schema';
import { login } from './auth.service';

export async function handleLogin(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parseResult = loginSchema.safeParse(req.body);
    if (!parseResult.success) {
      const issue = parseResult.error.issues[0];
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: issue?.message || 'Data login tidak valid.',
        },
      });
      return;
    }

    const result = await login(parseResult.data);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}
