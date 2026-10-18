import { Router } from 'express';
import { handleGetMe } from './users.controller';
import { requireAuth } from '../../middleware/auth';

const router = Router();

router.get('/', requireAuth, handleGetMe);

export const usersRouter = router;
