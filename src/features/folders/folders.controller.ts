import { Request, Response, NextFunction } from 'express';
import {
  createFolderSchema,
  updateFolderSchema,
  listFoldersQuerySchema,
} from './folders.schema';
import {
  createFolder,
  listFolders,
  getFolder,
  updateFolder,
  deleteFolder,
} from './folders.service';

export async function handleCreateFolder(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parseResult = createFolderSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: parseResult.error.issues[0]?.message || 'Data folder tidak valid.',
        },
      });
      return;
    }

    const userId = req.user!.id;
    const folder = await createFolder(userId, parseResult.data);
    res.status(201).json(folder);
  } catch (err) {
    next(err);
  }
}

export async function handleListFolders(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parseResult = listFoldersQuerySchema.safeParse(req.query);
    const parentId = parseResult.success ? parseResult.data.parentId : undefined;
    const folders = await listFolders(parentId);
    res.status(200).json({ folders });
  } catch (err) {
    next(err);
  }
}

export async function handleGetFolder(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const folderId = req.params.id as string;
    const folder = await getFolder(folderId);
    res.status(200).json(folder);
  } catch (err) {
    next(err);
  }
}

export async function handleUpdateFolder(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const folderId = req.params.id as string;
    const parseResult = updateFolderSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: parseResult.error.issues[0]?.message || 'Data update tidak valid.',
        },
      });
      return;
    }

    const folder = await updateFolder(folderId, parseResult.data);
    res.status(200).json(folder);
  } catch (err) {
    next(err);
  }
}

export async function handleDeleteFolder(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const folderId = req.params.id as string;
    await deleteFolder(folderId);
    res.status(200).json({ success: true, message: 'Folder berhasil dihapus.' });
  } catch (err) {
    next(err);
  }
}
