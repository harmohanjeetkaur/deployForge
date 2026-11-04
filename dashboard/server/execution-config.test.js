import test from 'node:test';
import assert from 'node:assert/strict';
import { createOperationRouter } from './operations.js';
import { executionState, validateExecutionConfig } from '../src/execution-state.js';

for (const real of [false, true]) test(`configuration accurately reports startup mode ${real} without invoking an operation`, () => {
  const router = createOperationRouter({ real, token: 'test-only-secret', environment: 'docker-desktop', deployer: { request() { assert.fail('must not run'); } } });
  const response = { set(name, value) { assert.equal(name, 'Cache-Control'); assert.equal(value, 'no-store'); }, json(body) { this.body = body; } };
  router.stack.find(layer => layer.route?.path === '/deploy/config').route.stack[0].handle({}, response);
  const config = validateExecutionConfig(response.body);
  assert.equal(config.dryRun, !real); assert.equal(config.executionEnabled, real);
  assert.equal(config.authenticationConfigured, true);
  assert.equal(executionState(config).key, real ? 'enabled' : 'disabled');
  assert.ok(!JSON.stringify(config).includes('test-only-secret'));
});

test('inconsistent and incomplete configuration fails closed rather than inventing a mode', () => {
  const config = { executionEnabled: true, dryRun: false, authenticationConfigured: true, environment: 'docker-desktop', capabilities: { realRequests: true } };
  for (const malformed of [null, {}, { ...config, dryRun: true }, { ...config, environment: '' }, { ...config, authenticationConfigured: 'true' }]) {
    assert.throws(() => validateExecutionConfig(malformed));
  }
  assert.equal(executionState(null, 'HTTP 503').ready, null);
  assert.match(executionState(null, 'HTTP 503').message, /HTTP 503/);
  assert.equal(executionState({ ...config, capabilities: {} }).key, 'unsupported');
  const missingAuth = executionState({ ...config, authenticationConfigured: false });
  assert.equal(missingAuth.key, 'enabled');
  assert.match(missingAuth.message, /authentication is missing/);
});
