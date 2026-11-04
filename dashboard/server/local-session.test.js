import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createLocalSessions } from './local-session.js';
import { createOperationRouter } from './operations.js';
const origin = 'http://localhost:5173';
async function fixture(run) {
  let time = 1000, executions = 0;
  const sessions = createLocalSessions({ token: 'operator-test-secret', now: () => time, pendingTTL: 100, sessionTTL: 1000, idleTTL: 500 });
  const app = express(); app.use(express.json()); app.use('/api', sessions.router);
  app.use('/api', createOperationRouter({ token: 'operator-test-secret', sessions, real: true, deployer: { request: async () => { executions++; return { dryRun: false, state: 'requested' }; } } }));
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  const call = async (path, { method = 'GET', cookie, csrf, bearer, source = origin, body } = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { Origin: source, 'Content-Type': 'application/json', ...(cookie && { Cookie: cookie }), ...(csrf && { 'X-CSRF-Token': csrf }), ...(bearer && { Authorization: `Bearer ${bearer}` }) }, ...(method !== 'GET' && { body: JSON.stringify(body || {}) }) });
    return { code: response.status, json: await response.json(), cookie: response.headers.get('set-cookie') };
  };
  try { await run({ call, sessions, advance: n => { time += n; }, count: () => executions }); } finally { await new Promise(resolve => server.close(resolve)); }
}
for (const operation of ['deploy','rollback']) test(`${operation}: pending sessions cannot execute; operator approval and CSRF are required`, () => fixture(async ({ call, count }) => {
  const pending = await call('/session/request', { method: 'POST' });
  assert.equal(pending.code, 201); assert.match(pending.cookie, /HttpOnly/); assert.match(pending.cookie, /Secure/); assert.match(pending.cookie, /SameSite=Strict/);
  assert.equal(pending.json.csrf, undefined);
  const cookie = pending.cookie.split(';')[0];
  const body = { tag: 'a'.repeat(40), execution: 'real', environment: 'docker-desktop' };
  assert.equal((await call(`/${operation}`, { method: 'POST', cookie, body })).code, 401);
  assert.equal((await call('/session/approve', { method: 'POST', body: { approvalId: pending.json.approvalId } })).code, 401);
  assert.equal((await call('/session/approve', { method: 'POST', bearer: 'operator-test-secret', body: { approvalId: pending.json.approvalId } })).code, 200);
  const authorized = (await call('/session', { cookie })).json;
  assert.equal(authorized.state, 'authorized'); assert.ok(authorized.csrf);
  assert.equal((await call(`/${operation}`, { method: 'POST', cookie, body })).code, 403);
  assert.equal((await call(`/${operation}`, { method: 'POST', cookie, csrf: authorized.csrf, source: 'https://evil.example', body })).code, 403);
  assert.equal(count(), 0);
  assert.equal((await call(`/${operation}`, { method: 'POST', cookie, csrf: authorized.csrf, body })).code, 202);
  assert.equal(count(), 1);
  await call('/session/logout', { method: 'POST', cookie, csrf: authorized.csrf });
  assert.equal((await call(`/${operation}`, { method: 'POST', cookie, csrf: authorized.csrf, body })).code, 401);
}));
test('pending approval and authorized sessions expire; unrelated cookies cannot claim them', () => fixture(async ({ call, advance }) => {
  const pending = await call('/session/request', { method: 'POST' }); const cookie = pending.cookie.split(';')[0];
  assert.equal((await call('/session')).json.state, 'none');
  advance(101);
  assert.equal((await call('/session/approve', { method: 'POST', bearer: 'operator-test-secret', body: { approvalId: pending.json.approvalId } })).code, 404);
  const next = await call('/session/request', { method: 'POST', cookie }); const nextCookie = next.cookie.split(';')[0];
  await call('/session/approve', { method: 'POST', bearer: 'operator-test-secret', body: { approvalId: next.json.approvalId } });
  advance(501); assert.equal((await call('/session', { cookie: nextCookie })).json.state, 'none');
  assert.equal((await call('/session/request', { method: 'POST', source: 'https://evil.example' })).code, 403);
}));
test('a backend restart invalidates sessions and approval never returns the operator credential', () => fixture(async ({ call }) => {
  const pending = await call('/session/request', { method: 'POST' }); const cookie = pending.cookie.split(';')[0];
  const approved = await call('/session/approve', { method: 'POST', bearer: 'operator-test-secret', body: { approvalId: pending.json.approvalId } });
  assert.deepEqual(approved.json, { approved: true });
  assert.equal(createLocalSessions({ token: 'operator-test-secret' }).view({ headers: { cookie } }).state, 'none');
}));

test('absolute lifetime expires even when authorized use refreshes the idle timer', () => fixture(async ({ call, advance }) => {
  const pending = await call('/session/request', { method: 'POST' }), cookie = pending.cookie.split(';')[0];
  await call('/session/approve', { method: 'POST', bearer: 'operator-test-secret', body: { approvalId: pending.json.approvalId } });
  const { csrf } = (await call('/session', { cookie })).json;
  for (let i = 0; i < 2; i++) {
    advance(400);
    assert.equal((await call('/deploy', { method: 'POST', cookie, csrf, body: { tag: 'a'.repeat(40), execution: 'real', environment: 'docker-desktop' } })).code, 202);
  }
  advance(201);
  assert.equal((await call('/session', { cookie })).json.state, 'none');
}));
test('pending sessions are bounded and expired entries are reclaimed', () => fixture(async ({ call, advance }) => {
  for (let i = 0; i < 32; i++) assert.equal((await call('/session/request', { method: 'POST' })).code, 201);
  assert.equal((await call('/session/request', { method: 'POST' })).code, 429);
  advance(101);
  assert.equal((await call('/session/request', { method: 'POST' })).code, 201);
}));
