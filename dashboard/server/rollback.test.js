import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeployer, isRollbackCandidate, IMAGE, VALUES } from './deployment.js';
import { createOperationRouter } from './operations.js';
import { buildDeploymentHistory } from './history.js';

const target = 'a'.repeat(40), current = 'b'.repeat(40), base = 'c'.repeat(40);
const original = `image:\n  repository: ${IMAGE}\n  tag: "${current}"\n\nother: preserved\n`;
const entry = { revision: '4', deploymentRevision: '5', isCurrent: false, containerImage: `${IMAGE}:${target}` };
function fixture(overrides = {}) {
  let content = original;
  const calls = [];
  const git = async args => {
    calls.push(args);
    if (args[0] === 'symbolic-ref') return 'main';
    if (args[0] === 'rev-parse') return base;
    if (args[0] === 'diff-tree') return VALUES;
    if (args[0] === 'show') return original.replace(current, target);
    return '';
  };
  const deployer = createDeployer({
    git, read: async () => content, write: async value => { calls.push(['write']); content = value; },
    verify: async () => ({ valid: true, exists: true, platformsSupported: true }),
    live: async () => `${IMAGE}:${current}`, history: async () => [entry], convergence: async () => true,
    ...overrides
  });
  return { deployer, calls, git, read: () => content };
}
async function finish(deployer) {
  for (let i = 0; i < 100 && ['requested', 'in-progress'].includes(deployer.status.state); i++) await new Promise(resolve => setImmediate(resolve));
  assert.ok(['succeeded', 'failed', 'dry-run'].includes(deployer.status.state));
  return deployer.status;
}
function routerFor(deployer, token = 'test-only-token') { return createOperationRouter({ deployer, token }); }
async function invoke(router, route, { tag = target, authorization = 'Bearer test-only-token', origin = 'http://localhost:5173', params = {}, query = {} } = {}) {
  const handler = router.stack.find(layer => layer.route?.path === route).route.stack[0].handle;
  const response = { code: 200, body: null, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await handler({ headers: { authorization, origin }, body: { tag }, params, query }, response);
  return response;
}

test('rollback dry-run returns operation and current image, without any write/fetch/push', async () => {
  const f = fixture();
  const result = await invoke(routerFor(f.deployer), '/rollback');
  assert.equal(result.code, 200);
  assert.equal(result.body.operation, 'rollback');
  assert.equal(result.body.state, 'dry-run');
  assert.equal(result.body.success, true);
  assert.equal(result.body.currentImage, `${IMAGE}:${current}`);
  assert.equal(f.read(), original);
  assert.ok(f.calls.every(args => ['symbolic-ref', 'status', 'rev-parse'].includes(args[0])));
});
test('successful mocked real rollback scopes commit/push and waits for exact convergence', async () => {
  const f = fixture({ real: true, convergence: async (tag, commit) => { assert.equal(tag, target); assert.equal(commit, base); return true; } });
  assert.equal((await f.deployer.request(target, 'rollback')).state, 'requested');
  const job = await finish(f.deployer);
  assert.equal(job.state, 'succeeded');
  assert.equal(job.operation, 'rollback');
  assert.match(job.message, /Rollback succeeded/);
  assert.equal(f.read(), original.replace(current, target));
  const commit = f.calls.find(args => args.includes('commit'));
  assert.ok(commit.includes('--only')); assert.equal(commit.at(-1), VALUES);
  assert.ok(commit.includes(`rollback: update image tag to ${target}`));
  assert.deepEqual(f.calls.find(args => args[0] === 'push'), ['push', 'origin', `${base}:refs/heads/main`]);
});
for (const tag of ['latest', 'short', 'A'.repeat(40), {}, current]) {
  test(`rollback rejects invalid/current target ${JSON.stringify(tag)}`, async () => {
    const f = fixture(); const response = await invoke(routerFor(f.deployer), '/rollback', { tag });
    assert.equal(response.code, 400); assert.equal(response.body.state, 'failed'); assert.equal(f.read(), original);
  });
}
for (const history of [[], [{ ...entry, isCurrent: true }], [{ ...entry, revision: '6' }], [{ ...entry, revision: 'unknown' }], [{ ...entry, containerImage: `other/repo:${target}` }], [{ ...entry, containerImage: `${IMAGE}:latest` }]]) {
  test(`rollback rejects ineligible retained history ${JSON.stringify(history)}`, async () => {
    const f = fixture({ history: async () => history });
    assert.equal((await f.deployer.request(target, 'rollback')).state, 'failed'); assert.equal(f.read(), original);
    assert.deepEqual(f.calls, []);
  });
}
for (const verification of [{ valid: true, exists: false }, { valid: true, exists: true, platformsSupported: false }]) {
  test(`rollback rejects unavailable or incompatible image ${JSON.stringify(verification)}`, async () => {
    const f = fixture({ verify: async () => verification });
    assert.equal((await f.deployer.request(target, 'rollback')).state, 'failed'); assert.deepEqual(f.calls, []);
  });
}
test('rollback fails closed when history cannot be read', async () => {
  const f = fixture({ history: async () => { throw new Error('history unavailable'); } });
  assert.match((await f.deployer.request(target, 'rollback')).message, /history unavailable/); assert.equal(f.read(), original);
});
for (const route of ['/deploy', '/rollback']) {
  for (const authorization of ['', 'Bearer incorrect', 'Basic incorrect']) {
    test(`${route} rejects authentication failure without invoking operation`, async () => {
      const router = routerFor({ request: () => assert.fail('unauthenticated operation invoked') });
      assert.equal((await invoke(router, route, { authorization })).code, 401);
    });
  }
  test(`${route} rejects missing server token`, async () => {
    const router = createOperationRouter({ deployer: { request: () => assert.fail() }, token: undefined });
    assert.equal((await invoke(router, route)).code, 500);
  });
  for (const origin of ['', 'https://example.invalid']) {
    test(`${route} rejects Origin ${JSON.stringify(origin)}`, async () => {
      assert.equal((await invoke(routerFor({ request: () => assert.fail() }), route, { origin })).code, 403);
    });
  }
}
for (const first of ['deploy', 'rollback']) {
  test(`${first} shares its lock with both operations and releases after completion`, async () => {
    let release; const waiting = new Promise(resolve => { release = resolve; });
    const f = fixture({ real: true, convergence: () => waiting });
    await f.deployer.request(target, first);
    const router = routerFor(f.deployer);
    for (const route of ['/rollback', '/deploy']) assert.equal((await invoke(router, route)).code, 409);
    release(true); assert.equal((await finish(f.deployer)).state, 'succeeded');
  });
}
for (const failure of ['branch', 'dirty', 'diverged', 'fetch', 'commit', 'push']) {
  test(`rollback handles Git ${failure} errors and preserves work`, async () => {
    let baseGit;
    const f = fixture({ real: true, git: async args => {
      if (failure === 'branch' && args[0] === 'symbolic-ref') return 'feature';
      if (failure === 'dirty' && args[0] === 'status') return ' M unrelated-file';
      if (failure === 'diverged' && args.includes('refs/remotes/origin/main')) return 'd'.repeat(40);
      if (args.includes(failure)) throw new Error(`simulated ${failure} failure`);
      return baseGit(args);
    } }); baseGit = f.git;
    await f.deployer.request(target, 'rollback'); const job = await finish(f.deployer);
    assert.equal(job.state, 'failed'); assert.match(job.message, /failed/);
    assert.equal(f.read(), ['commit', 'push'].includes(failure) ? original.replace(current, target) : original);
    assert.ok(!f.calls.some(args => ['reset', 'revert', 'checkout'].includes(args[0])));
  });
}
test('rollback timeout fails, preserves pushed change and never submits automatic recovery', async () => {
  let clock = 0;
  const f = fixture({ real: true, convergence: async () => false, now: () => clock, sleep: async () => { clock += 5000; }, timeout: 10000 });
  await f.deployer.request(target, 'rollback'); const job = await finish(f.deployer);
  assert.equal(job.state, 'failed'); assert.equal(job.success, false); assert.match(job.message, /Timed out/);
  assert.equal(f.calls.filter(args => args[0] === 'push').length, 1);
  assert.equal(f.read(), original.replace(current, target));
});
test('rollback revalidates retained history immediately before writing', async () => {
  let reads = 0; const f = fixture({ real: true, history: async () => ++reads === 1 ? [entry] : [] });
  await f.deployer.request(target, 'rollback'); assert.equal((await finish(f.deployer)).state, 'failed'); assert.equal(f.read(), original);
});
test('shared status endpoint returns rollback job by ID and rejects stale IDs', async () => {
  const f = fixture(); const router = routerFor(f.deployer); const job = (await invoke(router, '/rollback')).body;
  assert.equal((await invoke(router, '/deploy/status/:tag', { params: { tag: target }, query: { id: job.id } })).body.operation, 'rollback');
  assert.equal((await invoke(router, '/deploy/status/:tag', { params: { tag: target }, query: { id: 'stale' } })).code, 404);
});
test('history only accepts owned earlier immutable revisions and compares templates independent of label order', () => {
  const template = { metadata: { labels: { app: 'deployforge', instance: 'deployforge' } }, spec: { containers: [{ name: 'deployforge', image: `${IMAGE}:${current}` }] } };
  const deployment = { metadata: { name: 'deployforge', uid: 'owner-uid', annotations: { 'deployment.kubernetes.io/revision': '5' } }, spec: { template } };
  const rs = (revision, uid, image) => ({ metadata: { name: `rs-${revision}`, ownerReferences: [{ kind: 'Deployment', name: 'deployforge', uid }], annotations: { 'deployment.kubernetes.io/revision': revision } }, spec: { template: { metadata: { labels: { instance: 'deployforge', app: 'deployforge', 'pod-template-hash': 'ignored' } }, spec: { containers: [{ name: 'deployforge', image }] } } } });
  const history = buildDeploymentHistory(deployment, [rs('5', 'owner-uid', `${IMAGE}:${current}`), rs('4', 'owner-uid', `${IMAGE}:${target}`), rs('3', 'old-owner-uid', `${IMAGE}:${target}`), rs('2', 'owner-uid', `${IMAGE}:latest`)]);
  assert.equal(history.length, 3); assert.equal(history[0].isCurrent, true); assert.equal(history[0].rollbackEligible, false);
  assert.equal(history[1].rollbackEligible, true); assert.equal(history[2].rollbackEligible, false);
  assert.equal(isRollbackCandidate(entry, entry.containerImage), false);
});

test('revision 4 remains eligible after scaling down when current revision 5 is healthy', () => {
  const oldImage = `${IMAGE}:5b6d2c0589ab9e4a6dedbde072a95ccf124921aa`;
  const liveImage = `${IMAGE}:210426be6d6da6c2e16f234db410f83a0c98bbd2`;
  const template = image => ({ metadata: { labels: { app: 'deployforge' } }, spec: { containers: [{ name: 'deployforge', image }] } });
  const deployment = { metadata: { name: 'deployforge', uid: 'current-owner', annotations: { 'deployment.kubernetes.io/revision': '5' } }, spec: { replicas: 3, template: template(liveImage) }, status: { readyReplicas: 3 } };
  const previous = { metadata: { name: 'previous-rs', ownerReferences: [{ kind: 'Deployment', name: 'deployforge', uid: 'current-owner' }], annotations: { 'deployment.kubernetes.io/revision': '4' } }, spec: { replicas: 0, template: template(oldImage) }, status: { readyReplicas: 0 } };
  const [result] = buildDeploymentHistory(deployment, [previous]);
  assert.equal(result.rollbackEligible, true);
  assert.equal(result.deploymentRevision, '5');
  assert.equal(result.readyReplicas, 0);
});
