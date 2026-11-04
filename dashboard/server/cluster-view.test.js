import test from 'node:test';
import assert from 'node:assert/strict';
import { argoSummary } from './cluster-view.js';
test('Argo view reports live fields without exposing raw configuration or inferring health', () => {
  assert.deepEqual(argoSummary({}, 'deployforge'), { application: 'deployforge', sync: 'Unknown', health: 'Unknown', revision: null, operation: null, conditions: [] });
  const result = argoSummary({ spec: { secret: 'must-not-leak' }, status: { sync: { status: 'OutOfSync', revision: 'abc' }, health: { status: 'Degraded' }, operationState: { phase: 'Failed' }, conditions: [{ type: 'ComparisonError', message: 'sensitive stderr' }] } }, 'deployforge');
  assert.equal(result.sync, 'OutOfSync'); assert.equal(result.health, 'Degraded'); assert.equal(result.operation, 'Failed');
  assert.deepEqual(result.conditions, [{ type: 'ComparisonError' }]);
  assert.ok(!JSON.stringify(result).includes('sensitive')); assert.ok(!JSON.stringify(result).includes('must-not-leak'));
});
