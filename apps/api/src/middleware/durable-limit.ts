import { isIP } from 'node:net';
import { createHmac } from 'node:crypto';
import rateLimit, { type Store } from 'express-rate-limit';
import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';

// Atomic fixed windows use database time and work across processes/restarts.
// Keyed digests avoid persisting email addresses or raw IP addresses.
export function normalizeLimitIdentity(value: string) {
  if (isIP(value) !== 6) return value;
  const canonical = new URL(`http://[${value}]/`).hostname.slice(1, -1);
  const [left, right] = canonical.split('::');
  const head = left ? left.split(':') : [];
  const tail = right ? right.split(':') : [];
  const groups = right !== undefined ? [...head, ...Array(8 - head.length - tail.length).fill('0'), ...tail] : head;
  const words = groups.map(group => Number.parseInt(group, 16));
  if (words.slice(0, 5).every(word => word === 0) && words[5] === 65535) {
    return [words[6]! >> 8, words[6]! & 255, words[7]! >> 8, words[7]! & 255].join('.');
  }
  return `${words.slice(0, 4).map(word => word.toString(16)).join(':')}::/64`;
}

export class DurableLimitStore implements Store {
  localKeys = false;
  windowMs = 900000;
  prefix: string;
  constructor(private scope: string) { this.prefix = `${scope}:`; }
  init(options: { windowMs: number }) { this.windowMs = options.windowMs; }
  private key(value: string) { return createHmac('sha256', env.JWT_SECRET).update(`${this.scope}:${normalizeLimitIdentity(value)}`).digest('hex'); }
  async increment(value: string) {
    const key = this.key(value);
    const rows = await prisma.$queryRaw<Array<{ count: number; expiresAt: Date }>>`
      INSERT INTO abuse_buckets (key, count, "expiresAt")
      VALUES (${key}, 1, CURRENT_TIMESTAMP + ${this.windowMs} * INTERVAL '1 millisecond')
      ON CONFLICT (key) DO UPDATE SET
        count = CASE WHEN abuse_buckets."expiresAt" <= CURRENT_TIMESTAMP THEN 1 ELSE LEAST(abuse_buckets.count + 1, 1000000) END,
        "expiresAt" = CASE WHEN abuse_buckets."expiresAt" <= CURRENT_TIMESTAMP THEN EXCLUDED."expiresAt" ELSE abuse_buckets."expiresAt" END
      RETURNING count, "expiresAt"
    `;
    return { totalHits: rows[0]!.count, resetTime: rows[0]!.expiresAt };
  }
  async decrement(value: string) { await prisma.abuseBucket.updateMany({ where: { key: this.key(value) }, data: { count: { decrement: 1 } } }); }
  async resetKey(value: string) { await prisma.abuseBucket.deleteMany({ where: { key: this.key(value) } }); }
}

export function durableLimit(scope: string, max: number, account = false) {
  return rateLimit({ windowMs: 900000, max, store: new DurableLimitStore(scope),
    keyGenerator: req => account ? req.user!.userId : req.ip ?? 'unknown',
    standardHeaders: true, legacyHeaders: false,
    message: { success: false, error: 'Çok fazla deneme. Lütfen bekleyin.' } });
}
