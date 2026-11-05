import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, chmod, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { createReleaseService, createReleaseRouter } from './releases.js';
import { openReleaseStore } from './release-store.js';
import { createDeployer, IMAGE, VALUES } from './deployment.js';
import { createOperationRouter } from './operations.js';
import { createLocalSessions } from './local-session.js';

const sha = 'a'.repeat(40), old = 'b'.repeat(40), commit = 'c'.repeat(40), digest = `sha256:${'d'.repeat(64)}`;
const input = { repository: 'deployforge', ref: 'main', tag: 'v1.2.0', requestId: 'test-request-00001', environment: 'docker-desktop', execution: 'real' };
function fixture(overrides = {}) {
  const tags = new Map(), calls = [], state = { version: 1, releases: [] };
  let durable = structuredClone(state);
  const store = { state, save: async () => { durable = structuredClone(state); } };
  const github = {
    source: async (_r, ref) => { if (ref === 'missing') throw new Error('secret-in-upstream-error'); return { sha }; },
    sources: async () => [{ branch: 'main', sha }],
    tag: async (_r, name) => tags.get(name) || null,
    createTag: async (_r, name, value) => { calls.push('tag'); tags.set(name, value); },
    run: async () => ({ id: 123, attempt: 1, url: 'https://github.com/harmohanjeetkaur/deployForge/actions/runs/123', status: 'completed', conclusion: 'success', jobs: [] }),
    evidence: async () => ({ repository: 'harmohanjeetkaur/deployForge', tag: input.tag, sha, image: IMAGE, digest, runId: '123', runAttempt: 1, platforms: ['linux/amd64', 'linux/arm64'], security: 'passed' }),
    ...overrides.github,
  };
  const deployer = overrides.deployer || { busy: false, status: null,
    async request(tag, operation, options) {
      calls.push('deploy'); assert.equal(tag, sha); assert.equal(operation, 'deploy'); assert.equal(options.expectedDigest, digest);
      this.status = { id: 'promotion', tag, state: 'succeeded', stage: 'healthy', dryRun: false, commit, pushed: true, observation: { healthy: true, argoSynced: true, argoHealth: 'Healthy', readyReplicas: 3, desiredReplicas: 3 } };
      await options.checkpoint(this.status); return this.status;
    } };
  const deps = { store, deployer, verify: async () => ({ valid: true, exists: true, platformsSupported: true, digest }), observe: async () => ({ healthy: true }), enabled: true, ...overrides, github };
  const service = createReleaseService(deps);
  return { service, deps, tags, calls, durable: () => durable, github, deployer };
}

test('one click creates a tag, verifies actual CI/evidence/image and automatically promotes with durable history', async () => {
  const f = fixture(); const accepted = await f.service.create(input);
  assert.equal(accepted.state, 'tag-pending'); assert.equal(f.durable().releases[0].sha, sha);
  assert.deepEqual(f.calls, []);
  await f.service.tick();
  const result = f.service.get(accepted.id);
  assert.equal(result.state, 'succeeded'); assert.equal(result.digest, digest); assert.equal(result.run.id, 123);
  assert.deepEqual(f.calls, ['tag', 'deploy']); assert.equal(result.observation.healthy, true);
  assert.equal(f.durable().releases[0].state, 'succeeded'); assert.equal(f.service.busy, false);
});

test('execution disabled never resolves sources or mutates integrations', async () => {
  const f = fixture({ enabled: false, github: { source: () => assert.fail() } });
  await assert.rejects(f.service.create(input), { statusCode: 503 }); await f.service.tick(); assert.deepEqual(f.calls, []);
});
test('duplicate remote tag is rejected before scheduling', async () => {
  const f = fixture(); f.tags.set(input.tag, sha);
  await assert.rejects(f.service.create(input), { statusCode: 409 }); assert.equal(f.service.list().length, 0);
});
test('idempotency returns the accepted release but rejects reused keys with changed inputs', async () => {
  const f = fixture(); const r = await f.service.create(input);
  assert.equal((await f.service.create(input)).id, r.id);
  await assert.rejects(f.service.create({ ...input, tag: 'v1.3.0' }), { statusCode: 409 });
  await f.service.tick();
  await assert.rejects(f.service.create({ ...input, requestId: 'test-request-00002' }), { statusCode: 409 });
});
for (const invalid of [{ repository: 'attacker/repo' }, { ref: 'missing' }, { tag: 'latest' }, { tag: 'v1.0' }, { execution: 'dry-run' }, { environment: 'production' }, { requestId: '' }]) {
  test(`invalid release input never creates tag: ${JSON.stringify(invalid)}`, async () => {
    const f = fixture(); await assert.rejects(f.service.create({ ...input, ...invalid })); assert.deepEqual(f.calls, []);
  });
}
for (const security of [false, true]) test(`${security ? 'security scan' : 'CI'} failure prevents promotion`, async () => {
  const f = fixture({ github: { run: async () => ({ id: 123, attempt: 1, status: 'completed', conclusion: 'failure', jobs: security ? [{ steps: [{ name: 'Security policy', conclusion: 'failure' }] }] : [] }) } });
  const r = await f.service.create(input); await f.service.tick();
  assert.equal(f.service.get(r.id).failedStage, security ? 'security' : 'ci'); assert.deepEqual(f.calls, ['tag']);
});
for (const image of [{ valid: true, exists: false }, { valid: true, exists: true, platformsSupported: false }, { valid: true, exists: true, platformsSupported: true, digest: `sha256:${'e'.repeat(64)}` }]) {
  test('image missing, unsupported or mismatched digest never deploys', async () => {
    const f = fixture({ verify: async () => image }); const r = await f.service.create(input); await f.service.tick();
    assert.equal(f.service.get(r.id).failedStage, 'image'); assert.deepEqual(f.calls, ['tag']);
  });
}
test('forged CI evidence is rejected', async () => {
  const f = fixture({ github: { evidence: async () => ({ repository: 'attacker/repo', digest }) } });
  const r = await f.service.create(input); await f.service.tick(); assert.equal(f.service.get(r.id).failedStage, 'image'); assert.deepEqual(f.calls, ['tag']);
});
test('a changed tag prevents deployment', async () => {
  const f = fixture({ github: { run: async () => { f.tags.set(input.tag, old); return { id: 123, attempt: 1, status: 'completed', conclusion: 'success' }; } } });
  await f.service.create(input); await f.service.tick(); assert.deepEqual(f.calls, ['tag']); assert.notEqual(f.service.list()[0].state, 'succeeded');
});
test('concurrent creates, manual deployment and rollback cannot overlap a release', async () => {
  let resolveSource; const f = fixture({ github: { source: () => new Promise(resolve => { resolveSource = resolve; }) } });
  const request = f.service.create(input);
  assert.equal(f.service.busy, true);
  await assert.rejects(f.service.create({ ...input, tag: 'v1.3.0', requestId: 'test-request-00002' }), { statusCode: 409 });
  for (const action of ['deploy', 'rollback']) {
    const router = createOperationRouter({ deployer: { request: () => assert.fail() }, token: 'operator', real: true, releaseBusy: () => f.service.busy });
    const handler = router.stack.find(l => l.route?.path === `/${action}`).route.stack[0].handle;
    const response = { status(n) { this.code = n; return this; }, json() {} };
    await handler({ headers: { authorization: 'Bearer operator', origin: 'http://localhost:5173' }, body: { tag: sha, execution: 'real', environment: 'docker-desktop' } }, response);
    assert.equal(response.code, 409);
  }
  resolveSource({ sha }); await request;
});
test('existing deployment lock prevents a release', async () => {
  const f = fixture(); f.deployer.busy = true; await assert.rejects(f.service.create(input), { statusCode: 409 });
});
test('GitHub API timeout after accepted tag recovers without duplicate create', async () => {
  const f = fixture({ github: { createTag: async (_r, tag, value) => { f.calls.push('tag'); f.tags.set(tag, value); throw new Error('secret-error'); } } });
  const r = await f.service.create(input); await f.service.tick(); assert.equal(f.service.get(r.id).state, 'tag-pending');
  assert.ok(!JSON.stringify(f.service.list()).includes('secret-error'));
  await f.service.tick(); assert.deepEqual(f.calls, ['tag', 'deploy']); assert.equal(f.service.get(r.id).state, 'succeeded');
});
test('restart during CI resumes exact persisted release and never recreates tag', async () => {
  const f = fixture({ github: { run: async () => null } }); const r = await f.service.create(input); await f.service.tick();
  const store = { state: f.durable(), save: async () => {} };
  const resumed = createReleaseService({ ...f.deps, store, github: { ...f.github, run: async () => ({ id: 123, attempt: 1, status: 'completed', conclusion: 'success' }) } });
  await resumed.tick(); assert.equal(resumed.get(r.id).state, 'succeeded'); assert.deepEqual(f.calls, ['tag', 'deploy']);
});
for (const hasCommit of [false, true]) test(`restart after promotion intent (${hasCommit ? 'saved commit' : 'uncertain write'}) never invokes deployment twice`, async () => {
  const f = fixture(); const r = await f.service.create(input);
  Object.assign(f.deps.store.state.releases[0], { state: 'promoting', promotion: hasCommit ? { commit } : {} }); await f.deps.store.save();
  const resumed = createReleaseService({ ...f.deps, store: { state: f.durable(), save: async () => {} } });
  await resumed.tick(); assert.deepEqual(f.calls, []); assert.equal(resumed.get(r.id).state, hasCommit ? 'succeeded' : 'needs-review');
  if (!hasCommit) { await resumed.retry(r.id); await resumed.tick(); assert.deepEqual(f.calls, []); assert.equal(resumed.busy, false); }
});
test('deployment failure is retained and retry is observation-only', async () => {
  const f = fixture({ observe: async () => ({ healthy: false }), deployer: { status: null, async request() { this.status = { tag: sha, state: 'failed', stage: 'failed', commit, pushed: true }; return this.status; } } });
  const r = await f.service.create(input); await f.service.tick(); assert.equal(f.service.get(r.id).state, 'needs-review');
  await f.service.retry(r.id); await f.service.tick(); assert.equal(f.service.get(r.id).state, 'needs-review'); assert.equal(f.service.get(r.id).promotion.commit, commit);
});
test('journal failure disables all execution and retains exclusion', async () => {
  const f = fixture(); f.deps.store.save = async () => { throw new Error('disk full'); };
  await assert.rejects(f.service.create(input)); assert.equal(f.service.enabled, false); assert.equal(f.service.busy, true);
  await f.service.tick(); assert.deepEqual(f.calls, []);
});
test('CI retry observes same tag and rerun without creating or dispatching anything', async () => {
  const f = fixture({ github: { run: async () => ({ id: 123, attempt: 1, status: 'completed', conclusion: 'failure' }) } });
  const r = await f.service.create(input); await f.service.tick(); await f.service.retry(r.id);
  f.github.run = async () => ({ id: 123, attempt: 1, status: 'completed', conclusion: 'success' });
  await f.service.tick(); assert.equal(f.service.get(r.id).state, 'succeeded'); assert.deepEqual(f.calls, ['tag', 'deploy']);
});
test('release router enforces Origin, token/session CSRF, allowlist and disabled mode', async t => {
  const f = fixture({ enabled: false });
  const sessions = createLocalSessions({ token: 'operator' });
  const app = express(); app.use(express.json()); app.use('/api', sessions.router); app.use('/api', createReleaseRouter({ service: f.service, github: f.github, token: 'operator', sessions }));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const send = (path, body, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173', ...headers }, body: JSON.stringify(body) });
  assert.equal((await send('/releases', input)).status, 401);
  assert.equal((await send('/releases', input, { Authorization: 'Bearer invalid' })).status, 401);
  assert.equal((await send('/releases', input, { Authorization: 'Bearer operator', Origin: 'https://attacker.example' })).status, 403);
  assert.equal((await send('/releases', input, { Authorization: 'Bearer operator' })).status, 503);
  const pending = await send('/session/request', {}), cookie = pending.headers.get('set-cookie').split(';')[0], approval = await pending.json();
  await send('/session/approve', { approvalId: approval.approvalId }, { Authorization: 'Bearer operator' });
  assert.equal((await send('/releases', input, { Cookie: cookie })).status, 403);
  const session = await (await fetch(base + '/session', { headers: { Cookie: cookie } })).json();
  assert.equal((await send('/releases', input, { Cookie: cookie, 'X-CSRF-Token': session.csrf })).status, 503);
  const response = await fetch(base + '/repositories'); const config = await response.json();
  assert.equal(config.executionEnabled, false); assert.equal(config.repositories.length, 1); assert.ok(!JSON.stringify(config).includes('operator'));
  assert.equal((await fetch(base + '/repositories/attacker/source?ref=main')).status, 400);
});
test('disk journal survives reopening, enforces process exclusion, owner permissions and stale-lock recovery', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deployforge-release-'));
  let store = await openReleaseStore(dir);
  store.state.releases.push({ id: 'durable', state: 'ci', sha }); await store.save();
  assert.equal((await stat(join(dir, 'releases.json'))).mode & 0o777, 0o600);
  await assert.rejects(openReleaseStore(dir), /Another backend/);
  await store.close();
  store = await openReleaseStore(dir); assert.equal(store.state.releases[0].id, 'durable'); await store.close();
  await writeFile(join(dir, 'backend.lock'), '2147483647', { mode: 0o600 });
  store = await openReleaseStore(dir); assert.equal(store.state.releases[0].sha, sha); await store.close();
  await chmod(dir, 0o755); await assert.rejects(openReleaseStore(dir), /owner-only/); await chmod(dir, 0o700);
});
test('malformed journal fails closed rather than forgetting releases', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deployforge-corrupt-'));
  await writeFile(join(dir, 'releases.json'), 'corrupt', { mode: 0o600 });
  await assert.rejects(openReleaseStore(dir)); assert.equal(await readFile(join(dir, 'releases.json'), 'utf8'), 'corrupt');
});
test('real GitOps engine checkpoints persist before each mocked Git mutation, preserves rollback engine behavior', async () => {
  const events = []; let file = `image:\n  repository: ${IMAGE}\n  tag: "${old}"\n`;
  const engine = createDeployer({ real: true, verify: async () => ({ valid: true, exists: true, platformsSupported: true, digest }), live: async () => `${IMAGE}:${old}`,
    read: async () => file, write: async value => { events.push('write'); file = value; }, convergence: async () => ({ healthy: true, argoSynced: true, rolloutReady: true }),
    git: async args => {
      if (args[0] === 'symbolic-ref') return 'main'; if (args[0] === 'rev-parse') return commit;
      if (args[0] === 'diff-tree') return VALUES; if (args[0] === 'show') return file;
      if (args.includes('commit')) events.push('commit'); if (args[0] === 'push') events.push('push'); return '';
    } });
  const f = fixture({ deployer: engine }); await f.service.create(input);
  const save = f.deps.store.save; f.deps.store.save = async () => { events.push(`saved:${f.deps.store.state.releases[0].promotion?.stage || 'release'}`); await save(); };
  await f.service.tick();
  for (let i = 0; i < 100 && engine.busy; i++) await new Promise(resolve => setImmediate(resolve));
  await f.service.tick(); assert.equal(f.service.list()[0].state, 'succeeded');
  assert.ok(events.indexOf('saved:helm-write') < events.indexOf('write'));
  assert.ok(events.indexOf('saved:gitops-commit') < events.indexOf('commit'));
  assert.ok(events.indexOf('saved:git-push') < events.indexOf('push'));
});

test('known pre-write deployment validation failure can be retried without bypassing CI evidence', async () => {
  let requests = 0;
  const f = fixture({ deployer: { status: null, async request() { requests++; this.status = { tag: sha, state: 'failed', stage: 'failed', failureStage: 'request-accepted', progress: { commitCreated: false } }; return this.status; } } });
  const r = await f.service.create(input); await f.service.tick();
  assert.equal(f.service.get(r.id).state, 'failed'); assert.equal(f.service.get(r.id).failedStage, 'preflight');
  await f.service.retry(r.id); await f.service.tick(); assert.equal(requests, 2); assert.deepEqual(f.calls, ['tag']);
});
test('unsafe preflight fails before tag lookup or scheduling', async () => {
  const f = fixture({ preflight: async () => { throw new Error('dirty working tree'); }, github: { source: () => assert.fail('preflight must run first') } });
  await assert.rejects(f.service.create(input)); assert.equal(f.service.list().length, 0); assert.deepEqual(f.calls, []);
});

for (const state of ['failed', 'needs-review']) test(`${state} history does not block a new release after restart or replay old writes`, async () => {
  const f = fixture();
  const previous = await f.service.create(input);
  Object.assign(f.deps.store.state.releases[0], { state, stage: 'failed', promotion: { commit, pushed: false } });
  await f.deps.store.save();
  const resumed = createReleaseService({ ...f.deps, store: { state: f.durable(), save: async () => {} } });
  assert.equal(resumed.busy, false);
  await resumed.tick(); assert.deepEqual(f.calls, []);
  const next = await resumed.create({ ...input, tag: 'v1.3.0', requestId: 'test-request-00002' });
  assert.equal(next.state, 'tag-pending');
  assert.equal(resumed.get(previous.id).state, state);
  await assert.rejects(resumed.retry(previous.id), { statusCode: 409 });
  await assert.rejects(resumed.create({ ...input, tag: 'v1.4.0', requestId: 'test-request-00003' }), { statusCode: 409 });
  assert.deepEqual(f.calls, []);
});
