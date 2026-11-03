import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeployer, enabled, helmTag, ready, VALUES, IMAGE } from './deployment.js';
import { verifyImageTag } from './registry.js';
const tag = 'a'.repeat(40), old = 'b'.repeat(40), base = 'c'.repeat(40);
const content = `image:\n  repository: ${IMAGE}\n  pullPolicy: Always\n  tag: "${old}"\n\nother:\n  tag: "untouched"\n`;
function fixture(overrides = {}) {
  const calls = [];
  let file = content;
  const deps = {
    git: async args => {
      calls.push(args);
      if (args[0] === 'symbolic-ref') return 'main\n';
      if (args[0] === 'rev-parse') return base;
      if (args[0] === 'show') return content.replace(old, tag);
      if (args[0] === 'diff-tree') return VALUES;
      return '';
    },
    read: async () => file,
    write: async value => { calls.push(['write']); file = value; },
    verify: async () => ({ valid: true, exists: true, platformsSupported: true }),
    live: async () => `${IMAGE}:${old}`,
    convergence: async () => true,
    ...overrides
  };
  return { deployer: createDeployer(deps), calls, file: () => file };
}
async function finish(deployer) {
  for (let i = 0; i < 100 && ['requested', 'in-progress'].includes(deployer.status.state); i++) await new Promise(resolve => setImmediate(resolve));
  return deployer.status;
}
test('only literal true opts in', () => {
  for (const value of [undefined, '', 'false', 'TRUE', '1', true]) assert.equal(enabled(value), false);
  assert.equal(enabled('true'), true);
});
test('default dry-run only reads; no fetch, write, commit, push or convergence', async () => {
  const f = fixture({ convergence: () => assert.fail('no polling in dry run') });
  const result = await f.deployer.request(tag);
  assert.equal(result.state, 'dry-run');
  assert.equal(result.success, true);
  assert.equal(f.file(), content);
  assert.ok(f.calls.every(args => ['symbolic-ref', 'status', 'rev-parse'].includes(args[0])));
});
for (const invalid of ['latest', 'a'.repeat(39), 'A'.repeat(40), {}, null]) {
  test(`reject invalid SHA ${JSON.stringify(invalid)}`, async () => {
    const f = fixture({ verify: () => assert.fail('invalid tag reached registry') });
    assert.equal((await f.deployer.request(invalid)).state, 'failed');
    assert.deepEqual(f.calls, []);
  });
}
for (const image of [{ valid: false }, { valid: true, exists: false }, { valid: true, exists: true, platformsSupported: false }]) {
  test(`reject missing image or platforms ${JSON.stringify(image)}`, async () => {
    const f = fixture({ verify: async () => image });
    assert.equal((await f.deployer.request(tag)).state, 'failed');
    assert.deepEqual(f.calls, []);
  });
}
test('reject both Helm and live current tags', async () => {
  assert.equal((await fixture().deployer.request(old)).state, 'failed');
  const f = fixture({ live: async () => `${IMAGE}:${tag}` });
  assert.equal((await f.deployer.request(tag)).state, 'failed');
});
for (const scenario of ['branch', 'dirty', 'diverged', 'git-error']) {
  test(`reject Git ${scenario}`, async () => {
    const f = fixture({ git: async args => {
      if (scenario === 'git-error') throw new Error('fetch failed');
      if (args[0] === 'symbolic-ref') return scenario === 'branch' ? 'feature' : 'main';
      if (args[0] === 'status') return scenario === 'dirty' ? ' M unrelated' : '';
      return scenario === 'diverged' && args.includes('refs/remotes/origin/main') ? old : base;
    } });
    assert.equal((await f.deployer.request(tag)).state, 'failed');
    assert.equal(f.file(), content);
  });
}
test('image block update preserves other tags; ambiguous YAML rejected', () => {
  assert.equal(helmTag(content), old);
  assert.equal(helmTag(content, tag), content.replace(old, tag));
  assert.throws(() => helmTag(content + 'image:\n  tag: "another"\n'));
});
test('real path scopes commit and normal push, holds lock through convergence', async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const f = fixture({ real: true, convergence: () => pending });
  const result = await f.deployer.request(tag);
  assert.equal(result.state, 'requested');
  await assert.rejects(f.deployer.request(old), /already in progress/);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.deployer.status.state, 'in-progress');
  release(true);
  assert.equal((await finish(f.deployer)).state, 'succeeded');
  assert.equal(f.file(), content.replace(old, tag));
  assert.ok(f.calls.some(args => args.includes('--only') && args.at(-1) === VALUES));
  assert.deepEqual(f.calls.find(args => args[0] === 'push'), ['push', 'origin', `${base}:refs/heads/main`]);
});
test('push failure preserves file and commit; lock releases', async () => {
  const normal = fixture();
  const f = fixture({ real: true, git: async args => {
    if (args[0] === 'push') throw new Error('push rejected');
    return await (async () => {
      if (args[0] === 'symbolic-ref') return 'main';
      if (args[0] === 'rev-parse') return base;
      if (args[0] === 'show') return content.replace(old, tag);
      if (args[0] === 'diff-tree') return VALUES;
      return '';
    })();
  } });
  await f.deployer.request(tag);
  const status = await finish(f.deployer);
  assert.match(status.message, /Git push failed: push rejected/);
  assert.equal(f.file(), content.replace(old, tag));
  assert.equal((await normal.deployer.request(tag)).state, 'dry-run');
  await assert.doesNotReject(f.deployer.request(old));
});
test('convergence timeout reports failure without rollback', async () => {
  let clock = 0;
  const f = fixture({ real: true, convergence: async () => false, now: () => clock, sleep: async () => { clock += 5000; }, timeout: 10000 });
  await f.deployer.request(tag);
  assert.match((await finish(f.deployer)).message, /Timed out/);
  assert.ok(!f.calls.some(args => ['reset', 'revert', 'checkout'].includes(args[0])));
});
test('readiness requires target image, observed full rollout and exact Argo revision', () => {
  const d = { metadata: { generation: 2 }, spec: { replicas: 3, template: { spec: { containers: [{ name: 'deployforge', image: `${IMAGE}:${tag}` }] } } }, status: { observedGeneration: 2, replicas: 3, readyReplicas: 3, updatedReplicas: 3, availableReplicas: 3 } };
  const argo = { status: { sync: { status: 'Synced', revision: base }, health: { status: 'Healthy' } } };
  assert.equal(ready(d, argo, tag, base), true);
  assert.equal(ready(d, argo, old, base), false);
  assert.equal(ready(d, argo, tag, old), false);
  d.status.updatedReplicas = 2;
  assert.equal(ready(d, argo, tag, base), false);
});
test('GHCR uses repository path without hostname and checks both platforms', async () => {
  const urls = [];
  const mock = async url => {
    urls.push(url);
    return new Response(JSON.stringify({ manifests: ['amd64', 'arm64'].map(architecture => ({ platform: { os: 'linux', architecture } })) }), { status: 200 });
  };
  assert.equal((await verifyImageTag(tag, mock)).platformsSupported, true);
  assert.equal(urls[0], `https://ghcr.io/v2/harmohanjeetkaur/deployforge/manifests/${tag}`);
  assert.equal((await verifyImageTag(tag, async () => new Response('{}', { status: 404 }))).exists, false);
});

test('concurrent file changes during validation are preserved', async () => {
  let reads = 0;
  const f = fixture({ real: true, read: async () => ++reads === 1 ? content : content + '# user edit\n' });
  await f.deployer.request(tag);
  assert.match((await finish(f.deployer)).message, /Repository changed during validation/);
  assert.ok(!f.calls.some(args => args[0] === 'write' || args.includes('commit') || args[0] === 'push'));
});
test('unexpected commit contents prevent push', async () => {
  const f = fixture({ real: true, git: async args => {
    if (args[0] === 'symbolic-ref') return 'main';
    if (args[0] === 'rev-parse') return base;
    if (args[0] === 'diff-tree') return `${VALUES}\nunrelated.txt`;
    if (args[0] === 'push') assert.fail('must refuse push');
    return '';
  } });
  await f.deployer.request(tag);
  assert.match((await finish(f.deployer)).message, /Unexpected commit/);
});
test('GHCR anonymous authentication uses repository-only scope', async () => {
  const urls = [];
  const result = await verifyImageTag(tag, async (url, options) => {
    urls.push(url);
    if (urls.length === 1) return new Response('', { status: 401, headers: { 'www-authenticate': 'Bearer realm="https://ghcr.io/token",service="ghcr.io",scope="repository:harmohanjeetkaur/deployforge:pull"' } });
    if (urls.length === 2) return new Response(JSON.stringify({ token: 'mock-anonymous-token' }));
    assert.equal(options.headers.Authorization, 'Bearer mock-anonymous-token');
    return new Response(JSON.stringify({ manifests: [{ platform: { os: 'linux', architecture: 'amd64' } }] }));
  });
  assert.equal(urls[1], 'https://ghcr.io/token?service=ghcr.io&scope=repository:harmohanjeetkaur/deployforge:pull');
  assert.equal(result.exists, true);
  assert.equal(result.platformsSupported, false);
});
test('registry transport errors fail closed', async () => {
  const result = await verifyImageTag(tag, async () => { throw new Error('unavailable'); });
  assert.equal(result.exists, false);
  assert.equal(result.platformsSupported, false);
});


test('dry-run failure releases its lock and a subsequent request succeeds', async () => {
  let attempts = 0;
  const f = fixture({ verify: async () => ++attempts === 1
    ? { valid: true, exists: false, platformsSupported: false, error: 'registry unavailable' }
    : { valid: true, exists: true, platformsSupported: true } });
  assert.equal((await f.deployer.request(tag)).state, 'failed');
  const result = await f.deployer.request(tag);
  assert.equal(result.state, 'dry-run');
  assert.equal(result.success, true);
  assert.equal(f.file(), content);
});
test('registry TimeoutError is reported as a timeout', async () => {
  const result = await verifyImageTag(tag, async () => { throw new DOMException('expired', 'TimeoutError'); });
  assert.equal(result.exists, false);
  assert.equal(result.error, 'Registry request timed out');
});
