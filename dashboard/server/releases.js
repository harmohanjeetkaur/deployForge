import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { approvedRepository, repositories } from './repositories.js';
import { validBearer } from './local-session.js';

const terminal = r => ['succeeded', 'failed', 'needs-review'].includes(r.state);
const version = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/;
const digest = /^sha256:[a-f0-9]{64}$/;
const reject = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const snapshot = value => structuredClone(value);

export function createReleaseService({ store, github, verify, deployer, observe, preflight = async () => {}, enabled = false, now = Date.now }) {
  let running = false, creating = false, poisoned = false;
  const releases = store.state.releases;
  const active = () => releases.find(r => !terminal(r));
  const available = () => { if (!enabled || poisoned) throw reject('Release and deployment execution are disabled or the journal is unavailable', 503); };
  async function save(r, fields = {}) {
    Object.assign(r, fields, { updatedAt: new Date(now()).toISOString() });
    try { await store.save(); } catch (error) { poisoned = true; throw error; }
  }
  async function observePromotion(r, job) {
    await save(r, { promotion: snapshot(job), stage: job.stage, observation: job.observation || null });
    if (job.state === 'succeeded' && !job.dryRun) await save(r, { state: 'succeeded', message: 'Release deployed and observed healthy', finishedAt: new Date(now()).toISOString() });
    else if (job.state === 'failed' && job.failureStage === 'request-accepted' && !job.progress?.commitCreated) {
      await save(r, { state: 'failed', failedStage: 'preflight', message: 'GitOps validation failed before any write. Resolve prerequisites and retry reconciliation.' });
    } else if (job.state === 'failed' || job.dryRun) await save(r, { state: 'needs-review', message: 'GitOps promotion failed or was interrupted; inspect preserved Git state. Retry performs read-only reconciliation.' });
  }
  async function advance(r) {
    const repo = approvedRepository(r.repository);
    if (r.state === 'needs-review' || r.state === 'promoting') {
      // A durable intent can precede an accepted Git write. Never invoke it twice.
      if (r.promotion?.commit) {
        const observation = await observe(r.sha, r.promotion.commit);
        await save(r, { observation });
        if (observation.healthy) { await save(r, { state: 'succeeded', stage: 'healthy', message: 'Release deployed and observed healthy', finishedAt: new Date(now()).toISOString() }); return; }
      }
      await save(r, { state: 'needs-review', message: 'Promotion was interrupted or failed. Read-only reconciliation continues; inspect Git, ArgoCD and Kubernetes before any new promotion.' });
      return;
    }
    if (r.state === 'tag-pending') {
      const existing = await github.tag(repo, r.tag);
      if (existing && existing !== r.sha) { await save(r, { state: 'failed', failedStage: 'tag', message: 'Tag points to a different commit; choose a new tag' }); return; }
      if (!existing) await github.createTag(repo, r.tag, r.sha);
      // Handles restart/timeouts after GitHub accepted the create-ref call.
      await save(r, { state: 'ci', stage: 'ci', message: 'Tag created; waiting for its GitHub Actions run' });
    }
    if (r.state === 'ci') {
      if (await github.tag(repo, r.tag) !== r.sha) { await save(r, { state: 'failed', failedStage: 'tag', message: 'Release tag changed or disappeared; promotion refused' }); return; }
      const run = await github.run(repo, r);
      if (!run) { if (now() - Date.parse(r.createdAt) > 2 * 60 * 60 * 1000) await save(r, { state: 'failed', failedStage: 'ci', message: 'Timed out waiting for a tag-triggered workflow; check workflow installation and tag rules' }); return; }
      await save(r, { run, message: `GitHub Actions: ${run.status}` });
      if (run.status !== 'completed') return;
      if (run.conclusion !== 'success') {
        const security = run.jobs?.some(j => j.steps?.some(s => s.name === 'Security policy' && s.conclusion === 'failure'));
        await save(r, { state: 'failed', failedStage: security ? 'security' : 'ci', message: security ? 'Security policy failed; no promotion was requested' : 'CI did not succeed; no promotion was requested' }); return;
      }
      await save(r, { state: 'image', stage: 'image-publication', message: 'CI succeeded; verifying release evidence and registry image' });
    }
    if (r.state === 'image') {
      const evidence = await github.evidence(repo, r.run);
      if (evidence.repository?.toLowerCase() !== `${repo.owner}/${repo.repo}`.toLowerCase() || evidence.tag !== r.tag || evidence.sha !== r.sha
        || String(evidence.runId) !== String(r.run.id) || Number(evidence.runAttempt) !== r.run.attempt || evidence.image !== repo.image || !digest.test(evidence.digest || '')
        || evidence.security !== 'passed' || !['linux/amd64', 'linux/arm64'].every(p => evidence.platforms?.includes(p))) {
        await save(r, { state: 'failed', failedStage: 'image', message: 'Published CI evidence does not match this release' }); return;
      }
      const image = await verify(r.sha);
      if (!image.valid || !image.exists || !image.platformsSupported || image.digest !== evidence.digest) {
        await save(r, { state: 'failed', failedStage: 'image', message: 'SHA image publication, platforms or digest could not be verified; no promotion was requested' }); return;
      }
      // Revalidate the tag and exact workflow attempt immediately before promotion.
      const latest = await github.run(repo, r);
      if (await github.tag(repo, r.tag) !== r.sha || !latest || latest.id !== r.run.id || latest.attempt !== r.run.attempt || latest.conclusion !== 'success') throw reject('Release evidence changed before promotion');
      await save(r, { evidence, digest: evidence.digest, state: 'promoting', stage: 'gitops-promotion', message: 'Image verified; starting automatic GitOps promotion' });
      // Persist intent BEFORE invoking the old engine; checkpoints persist before
      // writes/commit/push and after commit. Recovery never blindly repeats this call.
      const checkpoint = async job => save(r, { promotion: snapshot(job), stage: job.stage, observation: job.observation || null });
      const job = await deployer.request(r.sha, 'deploy', { checkpoint, expectedDigest: r.digest });
      await checkpoint(job);
    }
    if (r.state === 'promoting' && deployer.status?.tag === r.sha) {
      await observePromotion(r, deployer.status);
    }
  }
  return {
    get busy() { return poisoned || creating || running || Boolean(active()); },
    get enabled() { return enabled && !poisoned; },
    list: () => snapshot(releases).reverse(),
    get(id) { const r = releases.find(item => item.id === id); if (!r) throw reject('Release not found', 404); return snapshot(r); },
    async create({ repository, ref, tag, requestId, environment, execution }) {
      available();
      const repo = approvedRepository(repository);
      if (execution !== 'real' || environment !== repo.environment) throw reject('Explicit real execution and matching environment are required');
      if (!version.test(tag || '') || tag.length > 100) throw reject('Use a version tag such as v1.2.0');
      if (typeof requestId !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(requestId)) throw reject('A unique requestId is required');
      const prior = releases.find(r => r.requestId === requestId);
      if (prior) {
        if (prior.repository !== repository || prior.ref !== ref || prior.tag !== tag) throw reject('requestId was already used for different release inputs', 409);
        return snapshot(prior);
      }
      if (creating || running || active() || deployer.busy) throw reject('Another release, deployment or rollback is active', 409);
      if (releases.some(r => r.repository === repository && r.tag === tag)) throw reject('Release tag already exists in history', 409);
      creating = true;
      try {
        await preflight(repo);
        const source = await github.source(repo, ref);
        if (!/^[a-f0-9]{40}$/.test(source.sha || '')) throw reject('Source must resolve to a full commit SHA');
        if (await github.tag(repo, tag)) throw reject('Git tag already exists; choose a new version', 409);
        const r = { id: randomUUID(), requestId, repository, ref, sha: source.sha, tag, environment,
          state: 'tag-pending', stage: 'tag-creation', createdAt: new Date(now()).toISOString(), message: 'Release accepted; tag creation pending' };
        releases.push(r); await save(r); return snapshot(r);
      } finally { creating = false; }
    },
    async retry(id) {
      available();
      if (creating || running || deployer.busy) throw reject('An operation is busy; wait before retrying', 409);
      const r = releases.find(item => item.id === id);
      if (!r) throw reject('Release not found', 404);
      if (active() && active() !== r) throw reject('Another release is active', 409);
      if (r.state === 'succeeded') throw reject('Release already succeeded', 409);
      if (r.state === 'failed' && r.failedStage === 'tag') throw reject('Tag conflict requires a new version', 409);
      if (r.state === 'needs-review') {
        // Explicit reconciliation reads observations only; historical failures
        // neither occupy the release queue nor replay uncertain Git writes.
        running = true;
        try { await advance(r); } finally { running = false; }
        return snapshot(r);
      }
      if (r.state === 'failed') await save(r, { state: 'ci', message: 'Retrying observation of the same tag and workflow; no new tag or CI dispatch' });
      return snapshot(r);
    },
    async tick() {
      if (!enabled || poisoned || running || creating) return;
      const r = active(); if (!r) return;
      running = true;
      try {
        // An in-process promotion is observed without re-entering recovery logic.
        if (r.state === 'promoting' && deployer.status?.tag === r.sha) {
          await observePromotion(r, deployer.status);
        } else await advance(r);
      } catch {
        // Never serialize upstream errors: HTTP bodies/SDK errors can contain secrets.
        await save(r, { message: 'Integration unavailable or evidence could not be read. Reconciliation will retry; no success is inferred.' });
      } finally { running = false; }
    },
  };
}

export function createReleaseRouter({ service, github, token, sessions }) {
  const router = Router();
  const wrap = fn => async (req, res) => { try { await fn(req, res); } catch (error) { res.status(error.statusCode || 502).json({ message: error.statusCode && error.statusCode < 500 ? error.message : 'Release integration unavailable; check server configuration and retry' }); } };
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (req.method === 'GET') return next();
    if (req.headers.origin !== 'http://localhost:5173') return res.status(403).json({ message: 'Dashboard Origin required' });
    if (!token) return res.status(503).json({ message: 'Local operator authorization is not configured' });
    if (req.headers.authorization) { if (!validBearer(req.headers.authorization, token)) return res.status(401).json({ message: 'Unauthorized' }); }
    else { const error = sessions?.authorize(req) || (!sessions && { status: 401, message: 'Local session required' }); if (error) return res.status(error.status).json({ message: error.message }); }
    next();
  });
  router.get('/repositories', (_req, res) => res.json({ repositories, executionEnabled: service.enabled }));
  router.get('/repositories/:id/sources', wrap(async (req, res) => res.json({ sources: await github.sources(approvedRepository(req.params.id)) })));
  router.get('/repositories/:id/source', wrap(async (req, res) => res.json(await github.source(approvedRepository(req.params.id), req.query.ref))));
  router.get('/releases', (_req, res) => res.json({ releases: service.list() }));
  router.get('/releases/:id', wrap(async (req, res) => res.json(service.get(req.params.id))));
  router.post('/releases', wrap(async (req, res) => res.status(202).json(await service.create(req.body || {}))));
  router.post('/releases/:id/retry', wrap(async (req, res) => res.json(await service.retry(req.params.id))));
  return router;
}
