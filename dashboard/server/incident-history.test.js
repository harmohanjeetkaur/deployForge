import test from 'node:test';
import assert from 'node:assert/strict';
import {createIncidentHistory} from './incident-history.js';
test('repeated observations retain first detection, deduplicate, and resolve healthy pods',()=>{
 let clock=0;const h=createIncidentHistory({now:()=>clock});const pod={name:'demo',uid:'1',ready:false,demo:true,restarts:2,reason:'CrashLoopBackOff'};
 const first=h.observe([pod],[])[0];clock=15000;const second=h.observe([pod],[])[0];assert.equal(second.firstSeen,first.firstSeen);assert.notEqual(second.lastSeen,first.lastSeen);assert.equal(h.observe([pod],[]).length,1);
 clock=30000;assert.equal(h.observe([{...pod,ready:true}],[])[0].state,'resolved');
});
test('missing pod is not falsely called recovered and unavailable alerts do not resolve',()=>{
 let clock=0;const h=createIncidentHistory({now:()=>clock});h.observe([{name:'demo',uid:'1',ready:false}], [{name:'DemoProbe',state:'firing',demo:true}]);clock=10000;
 const r=h.observe([],null);assert.equal(r.find(x=>x.source==='Kubernetes').state,'not-observed');assert.equal(r.find(x=>x.source==='Prometheus').state,'active');
 assert.equal(h.observe([],[]).find(x=>x.source==='Prometheus').state,'resolved');
 clock=3600001;assert.equal(h.observe([],[]).length,0);
});
