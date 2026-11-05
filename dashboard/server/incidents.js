import { createIncidentHistory } from './incident-history.js';
import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { validBearer } from './local-session.js';
export function createIncidentRouter({ collector, ai, token, sessions, now = Date.now, monitoring = async () => ({ alerts: null, demoProbes: null }) }) {
  const router = Router(), snapshots = new Map();
  const history = createIncidentHistory({ now });
  let busy = false, lastAnalysis = -Infinity;
  const wrap = fn => async (req, res) => { try { await fn(req, res); } catch (e) { res.status(e.statusCode || 502).json({ message: e.statusCode ? e.message : 'Incident evidence or diagnosis unavailable; check server configuration. No action was executed.' }); } };
  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.get('/incidents', wrap(async (_req, res) => {
    const [pods, signals] = await Promise.all([collector.list(), monitoring().catch(() => ({ alerts: null, demoProbes: null }))]);
    res.json({ pods, recent: history.observe(pods, signals.alerts), demoProbes: signals.demoProbes, ai: ai.config, namespace: 'deployforge-gitops', checkedAt: new Date(now()).toISOString(), historyScope: 'Observed since this backend started; at most one hour retained' });
  }));
  router.use('/incidents', (req, res, next) => {
    if (req.headers.origin !== 'http://localhost:5173') return res.status(403).json({ message: 'Dashboard Origin required' });
    if (!token) return res.status(503).json({ message: 'Local operator authorization must be configured' });
    const error = req.headers.authorization ? !validBearer(req.headers.authorization, token) && { status: 401, message: 'Unauthorized' } : sessions?.authorize(req) || (!sessions && { status: 401, message: 'Local session required' });
    if (error) return res.status(error.status).json({ message: error.message });
    next();
  });
  router.post('/incidents/evidence', wrap(async (req, res) => {
    if (req.body?.namespace !== 'deployforge-gitops') return res.status(400).json({ message: 'Namespace is not approved' });
    const evidence = await collector.collect(req.body.pod);
    for (const [id, item] of snapshots) if (now() - item.created > 300000) snapshots.delete(id);
    if (snapshots.size >= 20) snapshots.delete(snapshots.keys().next().value);
    const id = randomUUID(); snapshots.set(id, { created: now(), evidence });
    res.json({ id, ...evidence, expiresAt: new Date(now() + 300000).toISOString() });
  }));
  router.post('/incidents/analyze', wrap(async (req, res) => {
    if (req.body?.consent !== true) return res.status(400).json({ message: 'Review evidence and approve analysis first' });
    const item = snapshots.get(req.body.evidenceId);
    if (!item || now() - item.created > 300000) return res.status(409).json({ message: 'Evidence expired; collect a fresh snapshot' });
    if (busy) return res.status(409).json({ message: 'A diagnosis is already running' });
    if (item.result) return res.json(item.result);
    if (now() - lastAnalysis < 15000) return res.status(429).json({ message: 'Wait 15 seconds between AI requests' });
    busy = true; lastAnalysis = now();
    try { item.result = await ai.analyze(item.evidence); res.json(item.result); } finally { busy = false; }
  }));
  return router;
}
