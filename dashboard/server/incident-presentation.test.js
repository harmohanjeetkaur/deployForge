import test from 'node:test';
import assert from 'node:assert/strict';
import {groupAlerts,recentGroups,workloadName} from '../src/incident-presentation.js';
test('related readiness and endpoint alerts group without losing raw signals',()=>{
 const groups=groupAlerts([{name:'readiness',pod:'workload-123456789-abcde',state:'pending',demo:true},{name:'http',instance:'http://workload.ns.svc:8080/health',state:'firing'}]);
 assert.equal(groups.length,1);assert.equal(groups[0].alerts.length,2);assert.equal(groups[0].state,'firing');assert.equal(groups[0].demo,true);
 assert.equal(workloadName('single-pod'),'single-pod');
});
test('separate workloads remain separate and recent pod/alert observations correlate',()=>{
 assert.equal(groupAlerts([{name:'a',pod:'alpha-123456789-abcde'},{name:'b',pod:'beta-123456789-abcde'}]).length,2);
 const state={pods:[{name:'alpha-123456789-abcde',uid:'1',ready:false,reason:'CrashLoopBackOff',restarts:3}],recent:[{id:'a',pod:'alpha-123456789-abcde',source:'Prometheus',state:'active'},{id:'old',source:'Prometheus',state:'resolved'}]};
 const groups=recentGroups(state);assert.equal(groups.length,1);assert.equal(groups[0].signals,2);
});
