import test from 'node:test';
import assert from 'node:assert/strict';
import { createOperationRouter } from './operations.js';
import { createDeployer, convergenceStatus, IMAGE, VALUES } from './deployment.js';
const tag = 'a'.repeat(40), current = 'b'.repeat(40), commit = 'c'.repeat(40);
async function call(router, operation, body, authorization = 'Bearer test-only-token') {
  const handler = router.stack.find(layer => layer.route?.path === `/${operation}`).route.stack[0].handle;
  const response = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await handler({ headers: { authorization, origin: 'http://localhost:5173' }, body }, response);
  return response;
}
for (const operation of ['deploy', 'rollback']) {
  test(`${operation}: real UI intent fails closed when execution is disabled`, async () => {
    const router = createOperationRouter({ token: 'test-only-token', deployer: { request: () => assert.fail('must not simulate or deploy') } });
    const response = await call(router, operation, { tag, execution: 'real', environment: 'docker-desktop' });
    assert.equal(response.code, 503); assert.match(response.body.message, /not enabled/);
  });
  test(`${operation}: real UI request is connected to the existing operation engine`, async () => {
    const router = createOperationRouter({ token: 'test-only-token', real: true, deployer: { request: async (value, action) => { assert.equal(value, tag); assert.equal(action, operation); return { id: 'job', dryRun: false, state: 'requested' }; } } });
    assert.equal((await call(router, operation, { tag, execution: 'real', environment: 'docker-desktop' })).code, 202);
  });
  test(`${operation}: execution requires authentication, explicit intent and correct environment`, async () => {
    const router = createOperationRouter({ token: 'test-only-token', real: true, deployer: { request: () => assert.fail('invalid request reached engine') } });
    assert.equal((await call(router, operation, { tag, execution: 'real', environment: 'docker-desktop' }, 'Bearer wrong')).code, 401);
    assert.equal((await call(router, operation, { tag, execution: 'real', environment: 'production' })).code, 400);
    assert.equal((await call(router, operation, { tag })).code, 400);
  });
}
test('tooling retains backend default dry-run support without normal UI intent', async () => {
  const router = createOperationRouter({ token: 'test-only-token', deployer: { request: async () => ({ state: 'dry-run', dryRun: true, success: true }) } });
  const result = await call(router, 'deploy', { tag }); assert.equal(result.code, 200); assert.equal(result.body.dryRun, true);
});
const deployment = () => ({ metadata: { generation: 2 }, spec: { replicas: 3, template: { spec: { containers: [{ name: 'deployforge', image: `${IMAGE}:${tag}` }] } } }, status: { observedGeneration: 2, replicas: 3, updatedReplicas: 3, readyReplicas: 3, availableReplicas: 3 } });
const application = () => ({ status: { sync: { status: 'Synced', revision: commit }, health: { status: 'Healthy' }, operationState: { phase: 'Succeeded', syncResult: { revision: commit } } } });
test('convergence reports ArgoCD sync errors, rollout failure and degraded health accurately', () => {
  const d = deployment(), a = application();
  assert.equal(convergenceStatus(d, a, tag, commit).healthy, true);
  a.status.sync.revision = current; assert.equal(convergenceStatus(d, a, tag, commit).healthy, false);
  a.status.operationState.phase = 'Failed'; assert.match(convergenceStatus(d, a, tag, commit).failure, /synchronization failed/);
  a.status.operationState = { phase: 'Succeeded' }; a.status.sync.revision = commit; a.status.health.status = 'Degraded'; assert.match(convergenceStatus(d, a, tag, commit).failure, /Degraded/);
  a.status.health.status = 'Healthy'; d.status.conditions = [{ type: 'Progressing', status: 'False', reason: 'ProgressDeadlineExceeded' }]; assert.match(convergenceStatus(d, a, tag, commit).failure, /progress deadline/);
});
function fixture(observe, sleep = async () => {}) {
  const content = `image:\n  repository: ${IMAGE}\n  tag: "${current}"\n`;
  let file = content;
  return createDeployer({ real: true, git: async args => {
    if (args[0] === 'symbolic-ref') return 'main';
    if (args[0] === 'rev-parse') return commit;
    if (args[0] === 'diff-tree') return VALUES;
    if (args[0] === 'show') return content.replace(current, tag);
    return '';
  }, read: async () => file, write: async value => { file = value; }, verify: async () => ({ valid: true, exists: true, platformsSupported: true }), live: async () => `${IMAGE}:${current}`, convergence: observe, sleep });
}
async function finish(engine) { for (let i = 0; i < 100 && !['succeeded', 'failed'].includes(engine.status?.state); i++) await new Promise(resolve => setImmediate(resolve)); return engine.status; }
test('job reports observed rollout and health stages before success, rather than push success alone', async () => {
  let observations = 0; const stages = [];
  const engine = fixture(async () => { observations++; return { argoSynced: true, rolloutReady: observations >= 2, healthy: observations >= 3 }; }, async () => { stages.push(engine.status.stage); assert.equal(engine.status.success, false); });
  await engine.request(tag); const result = await finish(engine);
  assert.deepEqual(stages, ['kubernetes-rollout', 'health-verification']); assert.equal(result.stage, 'healthy'); assert.equal(result.success, true); assert.equal(result.pushed, true); assert.equal(result.progress.healthy, true);
});
for (const failure of ['ArgoCD synchronization failed', 'Kubernetes rollout exceeded its progress deadline', 'ArgoCD application health is Degraded']) {
  test(`terminal convergence failure never reports success: ${failure}`, async () => {
    const engine = fixture(async () => ({ healthy: false, argoSynced: false, rolloutReady: false, failure }));
    await engine.request(tag); const result = await finish(engine);
    assert.equal(result.state, 'failed'); assert.equal(result.success, false); assert.match(result.message, new RegExp(failure)); assert.equal(result.pushed, true);
  });
}

test('config exposes only the current process operation, disables caching and never includes credentials', async () => {
  const job = { id: 'latest', operation: 'rollback', state: 'succeeded', startedAt: '2026-11-04T13:00:00Z', progress: { healthy: true } };
  const router = createOperationRouter({ token: 'never-return-this-secret', real: true, deployer: { status: job } });
  const handler = router.stack.find(layer => layer.route?.path === '/deploy/config').route.stack[0].handle;
  const response = { set(name, value) { this.cache = [name, value]; }, json(body) { this.body = body; } };
  handler({}, response);
  assert.deepEqual(response.cache, ['Cache-Control', 'no-store']);
  assert.deepEqual(response.body.latestOperation, job);
  assert.equal(response.body.authenticationConfigured, true);
  assert.ok(!JSON.stringify(response.body).includes('never-return-this-secret'));
  const empty = createOperationRouter({ deployer: {} });
  empty.stack.find(layer => layer.route?.path === '/deploy/config').route.stack[0].handle({}, response);
  assert.equal(response.body.latestOperation, null);
  assert.equal(response.body.dryRun, true);
});

test('operation timestamps describe the observed process job without persisting history', async () => {
  const engine = fixture(async () => ({ healthy: true, argoSynced: true, rolloutReady: true }));
  await engine.request(tag, 'deploy');
  const result = await finish(engine);
  assert.equal(result.state, 'succeeded');
  assert.ok(Number.isFinite(Date.parse(result.startedAt)));
  assert.ok(Date.parse(result.finishedAt) >= Date.parse(result.startedAt));
});
