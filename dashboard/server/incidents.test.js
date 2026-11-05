import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createIncidentAI } from './incident-ai.js';
import { createIncidentCollector, redact } from './incident-collector.js';
import { createIncidentRouter } from './incidents.js';
const pod = { metadata:{name:'demo-pod',namespace:'deployforge-gitops',uid:'uid-1',labels:{'app.kubernetes.io/part-of':'deployforge-incident-demo'}}, spec:{containers:[{name:'startup-failure',env:[{name:'PRIVATE',value:'do-not-send'}]}]},status:{phase:'Running',containerStatuses:[{name:'startup-failure',ready:false,restartCount:3,state:{waiting:{reason:'CrashLoopBackOff'}}}]} };
const diagnosis={summary:'Startup failed',likelyCause:'Missing demo config',confidence:'high',evidenceIds:['pod'],checks:['Inspect startup logs'],remediation:['Provide the required demo configuration after review'],caveats:['Demo workload only']};
const evidence={pod:{name:'demo-pod'},sections:[{id:'pod',content:'CrashLoopBackOff'}]};
const response=value=>new Response(JSON.stringify(value));
test('collector runs only bounded get/logs commands and excludes env and secret resources',async()=>{
 const calls=[];
 const c=createIncidentCollector({kubectl:async args=>{calls.push(args);if(args[1]==='pods')return JSON.stringify({items:[pod,{...pod,metadata:{...pod.metadata,name:'other',labels:{app:'other'}}}]});if(args[0]==='logs')return 'password=secret api_key=sk-private-test123456789';if(args[1]==='events')return JSON.stringify({items:[]});throw Error('unavailable');}});
 const list=await c.list();assert.equal(list.length,1);assert.equal(list[0].demo,true);assert.equal(list[0].reason,'CrashLoopBackOff');
 const e=await c.collect('demo-pod');assert.ok(calls.every(a=>['get','logs'].includes(a[0])));assert.ok(calls.some(a=>a.includes('--previous=true')));assert.ok(!JSON.stringify(e).includes('do-not-send'));assert.ok(!JSON.stringify(e).includes('password=secret'));
 assert.equal(e.sections.find(s=>s.id==='argocd').available,false);
 await assert.rejects(c.collect('bad;curl'),{statusCode:400});await assert.rejects(c.collect('other'),{statusCode:404});
});
test('redaction masks credentials before preview and provider submission',()=>{
 const value='token=abc password="hello world" Authorization: Bearer abcd https://user:pass@example.com sk-private-key123456789';
 const clean=redact(value);for(const secret of ['hello world','abcd','user:pass','key123456789'])assert.ok(!clean.includes(secret));
});
test('OpenAI receives strict structured evidence, no storage or tools; output cites supplied IDs',async()=>{
 const ai=createIncidentAI({enabled:true,key:'private-key',fetcher:async(url,opts)=>{
  assert.equal(url,'https://api.openai.com/v1/responses');const body=JSON.parse(opts.body);assert.equal(body.store,false);assert.equal(body.tools,undefined);assert.equal(body.text.format.strict,true);assert.match(body.instructions,/untrusted/);assert.equal(body.input,JSON.stringify(evidence));
  return response({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(diagnosis)}]}]});
 }});
 assert.equal((await ai.analyze(evidence)).diagnosis.confidence,'high');assert.ok(!JSON.stringify(ai.config).includes('private-key'));
});
for (const [code, expected] of [
 ['insufficient_quota', /quota is unavailable/], ['credit_balance_exhausted', /credits are exhausted/],
 ['project_spend_limit_exceeded', /project spend limit/], ['organization_spend_limit_exceeded', /organization spend limit/],
 ['organization_usage_limit_exceeded', /organization usage limit/], ['rate_limit_exceeded', /temporary rate limit/],
 ['slow_down', /increased too quickly/], ['unknown', /specific cause is unavailable/],
]) test(`OpenAI 429 ${code} gives safe actionable guidance without retrying`, async () => {
 let calls = 0;
 const ai = createIncidentAI({ enabled: true, key: 'private-key', fetcher: async () => {
  calls++; return new Response(JSON.stringify({ error: { code, message: 'secret-provider-message' } }), { status: 429 });
 }});
 await assert.rejects(ai.analyze(evidence), error => error.statusCode === 429 && expected.test(error.message) && !error.message.includes('secret'));
 assert.equal(calls, 1);
});
for (const body of ['invalid secret JSON', 'x'.repeat(17000), JSON.stringify({error:{type:'insufficient_quota'}})])
 test('OpenAI 429 handles malformed, oversized and legacy quota errors safely', async () => {
  const ai = createIncidentAI({enabled:true,key:'key',fetcher:async()=>new Response(body,{status:429})});
  await assert.rejects(ai.analyze(evidence), error => error.statusCode === 429 && !error.message.includes('secret') &&
   (body.includes('insufficient_quota') ? /quota is unavailable/.test(error.message) : /specific cause is unavailable/.test(error.message)));
 });
for(const scenario of ['disabled','rate','failure','incomplete','invalid','fabricated'])test(`AI ${scenario} never reports valid success`,async()=>{
 const ai=createIncidentAI({enabled:scenario!=='disabled',key:'key',fetcher:async()=>{
  if(scenario==='rate')return new Response('secret error',{status:429});if(scenario==='failure')throw Error('secret provider response');
  return response({status:scenario==='incomplete'?'incomplete':'completed',output:[{content:[{type:'output_text',text:scenario==='invalid'?'bad JSON':JSON.stringify({...diagnosis,evidenceIds:['fabricated']})}]}]});
 }});await assert.rejects(ai.analyze(evidence),e=>!e.message.includes('secret'));
});
test('router enforces local auth, consent, TTL, deduplication and no mutation route',async t=>{
 let clock=0,calls=0;const app=express();app.use(express.json());app.use('/api',createIncidentRouter({collector:{list:async()=>[],collect:async()=>evidence},ai:{config:{enabled:true},analyze:async()=>{calls++;return{diagnosis};}},token:'operator',now:()=>clock}));
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base=`http://127.0.0.1:${server.address().port}/api/incidents`;
 const post=(path,body,headers={Origin:'http://localhost:5173',Authorization:'Bearer operator'})=>fetch(base+path,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await post('/evidence',{},{})).status,403);
 assert.equal((await post('/evidence',{}, {Origin:'http://localhost:5173'})).status,401);
 assert.equal((await post('/evidence',{namespace:'kube-system',pod:'x'})).status,400);
 const e=await post('/evidence',{namespace:'deployforge-gitops',pod:'demo-pod'}).then(r=>r.json());
 assert.equal((await post('/analyze',{evidenceId:e.id})).status,400);
 assert.equal((await post('/analyze',{evidenceId:e.id,consent:true})).status,200);
 await post('/analyze',{evidenceId:e.id,consent:true});assert.equal(calls,1);
 clock=300001;assert.equal((await post('/analyze',{evidenceId:e.id,consent:true})).status,409);
 assert.equal((await post('/execute',{})).status,404);
});
test('Helm application labels include healthy pods without including other workloads',async()=>{
 const healthy={...pod,metadata:{...pod.metadata,name:'deployforge-healthy',labels:{'app.kubernetes.io/name':'deployforge','app.kubernetes.io/instance':'deployforge'}},status:{phase:'Running',containerStatuses:[{ready:true,restartCount:0}]}};
 const c=createIncidentCollector({kubectl:async()=>JSON.stringify({items:[healthy]})});
 const result=await c.list();assert.equal(result[0].ready,true);assert.equal(result[0].demo,false);
});

test('incident authorization never intercepts existing deployment configuration routes',async t=>{
 const app=express();app.use('/api',createIncidentRouter({collector:{},ai:{config:{}},token:'operator'}));app.get('/api/deploy/config',(_req,res)=>res.json({environment:'docker-desktop'}));
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});t.after(()=>new Promise(resolve=>server.close(resolve)));
 const r=await fetch(`http://127.0.0.1:${server.address().port}/api/deploy/config`);assert.equal(r.status,200);assert.equal((await r.json()).environment,'docker-desktop');
});
