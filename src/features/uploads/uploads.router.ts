import { Router } from 'express';
import {
  handleInitUpload,
  handleCompleteUpload,
  handleAbortUpload,
} from './uploads.controller';
import { requireAuth } from '../../middleware/auth';

const router = Router();

router.use(requireAuth);

router.post('/init', handleInitUpload);
router.post('/complete', handleCompleteUpload);
router.post('/abort', handleAbortUpload);

export const uploadsRouter = router;
