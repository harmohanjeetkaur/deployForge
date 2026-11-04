import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';

const ORIGIN = 'http://localhost:5173';
const COOKIE = 'deployforge_session';
const options = { httpOnly: true, secure: true, sameSite: 'strict', path: '/api' };
const equal = (a, b) => { const x = Buffer.from(a || ''), y = Buffer.from(b || ''); return x.length === y.length && timingSafeEqual(x, y); };
export const validBearer = (header, token) => Boolean(token && typeof header === 'string' && header.startsWith('Bearer ') && equal(header.slice(7), token));
const digest = value => createHash('sha256').update(value).digest('hex');

export function createLocalSessions({ token, now = Date.now, pendingTTL = 120000, sessionTTL = 7200000, idleTTL = 1800000 } = {}) {
  const records = new Map();
  function prune() {
    for (const [key, record] of records) if (now() >= record.expiresAt || (record.approved && now() - record.lastUsed >= idleTTL)) records.delete(key);
  }
  function key(req) {
    const cookies = String(req.headers.cookie || '').split(';').map(c => c.trim()).filter(c => c.startsWith(`${COOKIE}=`));
    if (cookies.length !== 1) return null;
    const value = cookies[0].slice(COOKIE.length + 1);
    return /^[A-Za-z0-9_-]{43}$/.test(value) ? digest(value) : null;
  }
  function record(req) { prune(); return records.get(key(req)); }
  function view(req) {
    const item = record(req);
    if (!item) return { state: 'none' };
    return item.approved ? { state: 'authorized', csrf: item.csrf, expiresAt: item.expiresAt }
      : { state: 'pending', approvalId: item.approvalId, expiresAt: item.expiresAt };
  }
  function authorize(req) {
    const item = record(req);
    if (!item?.approved) return { status: 401, message: 'Local browser session is missing, expired, or awaiting approval' };
    if (!equal(req.headers['x-csrf-token'], item.csrf)) return { status: 403, message: 'Local session request verification failed; reconnect your session' };
    item.lastUsed = now();
    return null;
  }
  const router = Router();
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    // Safe GETs reveal session state only to a browser possessing its cookie.
    if (req.method !== 'GET' && req.headers.origin !== ORIGIN) return res.status(403).json({ message: 'Local session requests require the dashboard Origin' });
    if (req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).json({ message: 'Cross-site session requests are forbidden' });
    next();
  });
  router.get('/session', (req, res) => res.json(view(req)));
  router.post('/session/request', (req, res) => {
    if (!token) return res.status(503).json({ message: 'Local authorization is not configured on the backend' });
    if (record(req)) return res.json(view(req));
    prune();
    if (records.size >= 32) return res.status(429).json({ message: 'Too many local sessions; wait for pending sessions to expire' });
    const secret = randomBytes(32).toString('base64url');
    let approvalId;
    do { approvalId = randomBytes(4).toString('hex'); } while ([...records.values()].some(r => r.approvalId === approvalId));
    const item = { approvalId, approved: false, expiresAt: now() + pendingTTL };
    records.set(digest(secret), item);
    res.cookie(COOKIE, secret, options);
    res.status(201).json({ state: 'pending', approvalId: item.approvalId, expiresAt: item.expiresAt });
  });
  const operator = (req, res, next) => validBearer(req.headers.authorization, token) ? next() : res.status(401).json({ message: 'Local operator authorization required' });
  router.get('/session/pending', operator, (req, res) => {
    prune(); res.json({ pending: [...records.values()].filter(r => !r.approved).map(({ approvalId, expiresAt }) => ({ approvalId, expiresAt })) });
  });
  router.post('/session/approve', operator, (req, res) => {
    prune();
    const item = [...records.values()].find(r => !r.approved && r.approvalId === req.body?.approvalId);
    if (!item) return res.status(404).json({ message: 'Pending browser session not found or expired' });
    Object.assign(item, { approved: true, csrf: randomBytes(32).toString('base64url'), expiresAt: now() + sessionTTL, lastUsed: now() });
    res.json({ approved: true });
  });
  router.post('/session/logout', (req, res) => {
    const rejected = authorize(req);
    if (rejected) return res.status(rejected.status).json({ message: rejected.message });
    records.delete(key(req)); res.clearCookie(COOKIE, options); res.json({ state: 'none' });
  });
  return { router, authorize, view };
}
