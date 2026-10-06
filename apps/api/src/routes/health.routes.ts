import { Router, type Request } from 'express';
import { prisma } from '../config/prisma.js';
import { getRequestId } from '../utils/request-context.js';
import { logInfo } from '../utils/logger.js';
const router: Router = Router();
const base = (req: Request, mode: string) => ({ status: 'ok', service: 'api', mode,
  requestId: getRequestId(req) });
router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
router.get('/', (req, res) => { res.json(base(req, 'live')); });
// One bounded DB transaction, shared across overlapping probes. Timeout is also
// enforced by PostgreSQL, so hung work does not accumulate behind a Promise race.
let pending: Promise<void> | null = null;
export function databaseProbe() {
  if (!pending) pending = prisma.$transaction(async tx => {
    await tx.$executeRaw`SET LOCAL statement_timeout = '2000ms'`;
    await tx.$queryRaw`SELECT 1`;
  }, { maxWait: 2000, timeout: 3000 }).finally(() => { pending = null; });
  const check = pending;
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Readiness timeout")), 5000);
    check.then(() => { clearTimeout(timer); resolve(); }, () => { clearTimeout(timer); reject(new Error("Readiness failed")); });
  });
}
router.get('/ready', async (req, res) => {
  const started = Date.now();
  try {
    await databaseProbe();
    res.json({ ...base(req, 'ready'), checks: { database: { status: 'ok' } } });
  } catch {
    logInfo('database_probe', { operation: 'database', outcome: 'failure', reason: 'timeout',
      requestId: getRequestId(req), durationMs: Date.now() - started });
    res.status(503).json({ ...base(req, 'ready'), status: 'error', checks: { database: { status: 'error' } } });
  }
});
export default router;
