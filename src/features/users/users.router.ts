import { Router } from 'express';
import { handleGetMe, handleGetAllUsers, handleGetR2Usage } from './users.controller';
import { requireAuth } from '../../middleware/auth';

const router = Router();

router.use(requireAuth);

router.get('/', handleGetMe);
router.get('/r2-usage', handleGetR2Usage);
router.get('/all', handleGetAllUsers);

export const usersRouter = router;
