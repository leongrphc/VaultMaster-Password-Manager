import { Router, type Request, type Response } from "express";
import { createFolderSchema, updateFolderSchema } from "@vaultmaster/shared";
import { prisma } from "../config/prisma.js";
import { authMiddleware } from "../middleware/auth.js";

const router: Router = Router();

router.use(authMiddleware);

// GET /api/folders
router.get("/", async (req: Request, res: Response) => {
  const folders = await prisma.folder.findMany({
    where: { userId: req.user!.userId },
    orderBy: { name: "asc" },
  });

  const foldersWithCounts = await Promise.all(
    folders.map(async (folder) => ({
      ...folder,
      _count: {
        items: await prisma.vaultItem.count({
          where: {
            folderId: folder.id,
            userId: req.user!.userId,
            deletedAt: null,
          },
        }),
      },
    }))
  );

  res.json({ success: true, data: foldersWithCounts });
});

// POST /api/folders
router.post("/", async (req: Request, res: Response) => {
  const body = createFolderSchema.parse(req.body);

  const folder = await prisma.folder.create({
    data: {
      name: body.name,
      userId: req.user!.userId,
    },
  });

  res.status(201).json({
    success: true,
    data: {
      ...folder,
      _count: { items: 0 },
    },
  });
});

// PUT /api/folders/:id
router.put("/:id", async (req: Request, res: Response) => {
  const body = updateFolderSchema.parse(req.body);

  const existing = await prisma.folder.findFirst({
    where: { id: req.params.id as string, userId: req.user!.userId },
  });

  if (!existing) {
    res.status(404).json({ success: false, error: "Klasör bulunamadı" });
    return;
  }

  const updated = await prisma.folder.update({
    where: { id: req.params.id as string },
    data: { name: body.name },
  });

  res.json({
    success: true,
    data: {
      ...updated,
      _count: {
        items: await prisma.vaultItem.count({
          where: {
            folderId: updated.id,
            userId: req.user!.userId,
            deletedAt: null,
          },
        }),
      },
    },
  });
});

// DELETE /api/folders/:id
router.delete("/:id", async (req: Request, res: Response) => {
  const existing = await prisma.folder.findFirst({
    where: { id: req.params.id as string, userId: req.user!.userId },
  });

  if (!existing) {
    res.status(404).json({ success: false, error: "Klasör bulunamadı" });
    return;
  }

  await prisma.folder.delete({ where: { id: req.params.id as string } });

  res.json({ success: true, data: { message: "Klasör silindi" } });
});

export default router;
