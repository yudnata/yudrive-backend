import { Router } from 'express';
import {
  handleListMedia,
  handleGetMediaUrl,
  handleDeleteMedia,
  handleMoveMedia,
  handleBatchDelete,
  handleBatchMove,
} from './media.controller';
import { requireAuth } from '../../middleware/auth';

const router = Router();

router.use(requireAuth);

router.get('/', handleListMedia);
router.post('/batch-delete', handleBatchDelete);
router.post('/batch-move', handleBatchMove);
router.get('/:id/url', handleGetMediaUrl);
router.patch('/:id/move', handleMoveMedia);
router.delete('/:id', handleDeleteMedia);

export const mediaRouter = router;
