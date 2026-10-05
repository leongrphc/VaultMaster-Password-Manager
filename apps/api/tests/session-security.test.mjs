import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ||= 'postgresql://test:test@localhost:5432/vaultmaster_unit';
process.env.DATABASE_DIRECT_URL ||= process.env.DATABASE_URL;
process.env.JWT_SECRET ||= 'unit-access-secret'.repeat(3);
process.env.JWT_REFRESH_SECRET ||= 'unit-refresh-secret'.repeat(3);
process.env.APP_ENCRYPTION_KEY ||= Buffer.alloc(32, 7).toString('base64');
process.env.API_PORT ||= '4000';
const { generateAccessToken, generateRefreshToken, verifyAccessToken, verifyRefreshToken } = await import('../dist/utils/jwt.js');
const { authMiddleware } = await import('../dist/middleware/auth.js');
const { prisma } = await import('../dist/config/prisma.js');
const claims = { userId: 'user-1', email: 'user@example.test', deviceId: 'device-1' };

test('tokens remain unique when issued repeatedly in the same second', () => {
  const tokens = Array.from({ length: 20 }, () => generateRefreshToken(claims));
  assert.equal(new Set(tokens).size, tokens.length);
  assert.deepEqual(verifyRefreshToken(tokens[0]), claims);
  assert.deepEqual(verifyAccessToken(generateAccessToken(claims)), claims);
});

test('rejects legacy, wrong-purpose, wrong-issuer and wrongly signed tokens', () => {
  assert.throws(() => verifyAccessToken(generateRefreshToken(claims)));
  assert.throws(() => verifyRefreshToken(generateAccessToken(claims)));
  // Use the validated environment to keep these assertions valid in CI too.
  const { JWT_SECRET } = process.env;
  const options = { algorithm: 'HS256', issuer: 'vaultmaster-api', audience: 'vaultmaster', jwtid: 'fixture', expiresIn: '1m' };
  assert.throws(() => verifyAccessToken(jwt.sign({ userId: claims.userId, email: claims.email }, JWT_SECRET)));
  assert.throws(() => verifyAccessToken(jwt.sign({ ...claims, tokenUse: 'refresh' }, JWT_SECRET, options)));
  assert.throws(() => verifyAccessToken(jwt.sign({ ...claims, tokenUse: 'access' }, JWT_SECRET, { ...options, issuer: 'other' })));
  assert.throws(() => verifyAccessToken(jwt.sign({ ...claims, tokenUse: 'access' }, 'other-secret', options)));
});

async function requestWithSession(result) {
  const original = prisma.device.findFirst;
  let query;
  prisma.device.findFirst = async options => { query = options; if (result instanceof Error) throw result; return result; };
  try {
    const req = { headers: { authorization: `Bearer ${generateAccessToken(claims)}` } };
    const res = { statusCode: null, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    const nextCalls = [];
    await authMiddleware(req, res, error => nextCalls.push(error));
    return { req, res, nextCalls, query };
  } finally { prisma.device.findFirst = original; }
}

test('a live session permits requests and checks device ownership and reuse status', async () => {
  const response = await requestWithSession({ id: claims.deviceId });
  assert.deepEqual(response.req.user, claims);
  assert.equal(response.nextCalls.length, 1);
  assert.deepEqual(response.query.where, { id: claims.deviceId, userId: claims.userId, refreshTokenReusedAt: null, refreshTokenHash: { not: null } });
});

test('a revoked session rejects its still-unexpired access token', async () => {
  const response = await requestWithSession(null);
  assert.equal(response.res.statusCode, 401);
  assert.equal(response.nextCalls.length, 0);
  assert.equal(response.req.user, undefined);
});

test('a database failure reaches error handling without logging the user out', async () => {
  const failure = new Error('database unavailable');
  const response = await requestWithSession(failure);
  assert.deepEqual(response.nextCalls, [failure]);
  assert.equal(response.res.statusCode, null);
});
