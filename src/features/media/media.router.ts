import { Router } from 'express';
import {
  handleListMedia,
  handleGetMediaUrl,
  handleDeleteMedia,
} from './media.controller';
import { requireAuth } from '../../middleware/auth';

const router = Router();

router.use(requireAuth);

router.get('/', handleListMedia);
router.get('/:id/url', handleGetMediaUrl);
router.delete('/:id', handleDeleteMedia);

export const mediaRouter = router;
