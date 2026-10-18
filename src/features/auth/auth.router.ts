import { Router } from 'express';
import { handleLogin } from './auth.controller';
import { authRateLimiter } from '../../middleware/rateLimiter';

const router = Router();

router.post('/login', authRateLimiter, handleLogin);

export const authRouter = router;
