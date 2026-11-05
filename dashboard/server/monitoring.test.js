import test from 'node:test';
import assert from 'node:assert/strict';
import { monitoringStatus } from './monitoring.js';
test('reports real target health and bounded local destinations', async () => {
  const result = await monitoringStatus(async url => {
    assert.equal(new URL(url).hostname, '127.0.0.1');
    return { ok: true, json: async () => ({ status: 'success', data: { activeTargets: [{ health: 'up' }, { health: 'down' }] } }) };
  });
  assert.equal(result.services[0].status, 'down');
  assert.match(result.services[0].message, /1\/2/);
  assert.equal(result.services[1].status, 'up');
});
test('unreachable or invalid monitoring never claims health', async () => {
  for (const fetcher of [async () => { throw new Error('network'); }, async () => ({ ok: false })]) {
    assert.ok((await monitoringStatus(fetcher)).services.every(s => s.status === 'down'));
  }
});
test('all verified targets up and empty collection distinguished', async () => {
  for (const targets of [[], [{ health: 'up' }]]) {
    const r = await monitoringStatus(async () => ({ ok: true, json: async () => ({ status: 'success', data: { activeTargets: targets } }) }));
    assert.equal(r.services[0].status, targets.length ? 'up' : 'down');
  }
});
test('live summaries and chart points preserve unavailable data and exclude NaN', async () => {
  const r = await monitoringStatus(async url => {
    const u = new URL(url), q = u.searchParams.get('query') || '';
    let data = {};
    if(u.pathname.endsWith('/targets')) data = { activeTargets: [{ labels: { job: 'probe', instance: 'health' }, health: 'up', lastScrapeDuration: 0.01 }] };
    else if(u.pathname.endsWith('/alerts')) data = { alerts: [{ labels: { alertname: 'ProbeDown', severity: 'warning' }, state: 'pending' }] };
    else if(u.pathname.endsWith('/query_range')) data = { result: [{ values: [[1, 'NaN'], [2, '100']] }] };
    else if(q.includes('available')) data = { result: [{ value: [1, '3'] }] };
    else if(q.includes('spec_replicas')) data = { result: [] };
    else if(q.includes('argocd')) data = { result: [{ metric: { sync_status: 'Synced', health_status: 'Healthy' } }] };
    else data = { result: [{ value: [1, 'NaN'] }] };
    return { ok: true, json: async () => ({ status: 'success', data }) };
  });
  assert.equal(r.summary.ready, 3);
  assert.equal(r.summary.desired, null);
  assert.equal(r.summary.probeSuccess, null);
  assert.equal(r.summary.argoHealth, 'Healthy');
  assert.deepEqual(r.trends.availability, [[2, 100]]);
  assert.equal(r.alerts[0].state, 'pending');
  assert.equal(r.targets[0].duration, 0.01);
});
test('demo probe failures preserve actual HTTP status without changing application health',async()=>{
 const m=await monitoringStatus(async url=>{
  const u=new URL(url),q=u.searchParams.get('query')||'';let data={};
  if(u.pathname.endsWith('/targets'))data={activeTargets:[{health:'up'}]};
  else if(u.pathname.endsWith('/alerts'))data={alerts:[{labels:{alertname:'DemoProbe',demo:'true',severity:'warning'},state:'firing',annotations:{summary:'Intentional demo'}}]};
  else data={result:[{metric:{instance:'demo-endpoint'},value:[1,q.includes('probe_http_status_code')?'404':q.includes('demo-incident-probes')?'0':'1']}]};
  return {ok:true,json:async()=>({status:'success',data})};
 });assert.equal(m.demoProbes[0].success,0);assert.equal(m.demoProbes[0].httpStatus,404);assert.equal(m.summary.probeSuccess,1);assert.equal(m.alerts[0].demo,true);
});
