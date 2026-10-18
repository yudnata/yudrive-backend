import { Router } from 'express';
import {
  handleListMedia,
  handleGetRandomMedia,
  handleGetMediaUrl,
  handleDeleteMedia,
  handleMoveMedia,
  handleBatchDelete,
  handleBatchMove,
  handleToggleFavorite,
  handleBatchFavorite,
} from './media.controller';
import { requireAuth } from '../../middleware/auth';

const router = Router();

router.use(requireAuth);

router.get('/', handleListMedia);
router.get('/random', handleGetRandomMedia);
router.post('/batch-delete', handleBatchDelete);
router.post('/batch-move', handleBatchMove);
router.post('/batch-favorite', handleBatchFavorite);
router.get('/:id/url', handleGetMediaUrl);
router.patch('/:id/move', handleMoveMedia);
router.patch('/:id/favorite', handleToggleFavorite);
router.post('/:id/favorite', handleToggleFavorite);
router.delete('/:id', handleDeleteMedia);

export const mediaRouter = router;
