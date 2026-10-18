import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import {
  handleCreateFolder,
  handleListFolders,
  handleGetFolder,
  handleUpdateFolder,
  handleDeleteFolder,
} from './folders.controller';

const router = Router();

router.use(requireAuth);

router.post('/', handleCreateFolder);
router.get('/', handleListFolders);
router.get('/:id', handleGetFolder);
router.patch('/:id', handleUpdateFolder);
router.delete('/:id', handleDeleteFolder);

export const foldersRouter = router;
