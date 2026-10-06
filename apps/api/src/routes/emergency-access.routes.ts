import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
// Legacy manually-wrapped keys have no authenticated protocol or consent.
// Retain database rows for migration/recovery; never release them through v1.
const router: Router = Router();
router.use(authMiddleware);
router.use((_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.status(410).json({ success: false, error: 'Eski paylaşım protokolü kapatıldı. Yeni bir cihaz daveti oluşturun.' });
});
export default router;
