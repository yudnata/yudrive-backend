import { Router } from 'express';
import { getHealth } from './health.controller';

const router = Router();

router.get('/', getHealth);

export const healthRouter = router;
