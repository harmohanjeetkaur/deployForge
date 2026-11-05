import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { securitySummary } from './security.js';
import { createReleaseRouter } from './releases.js';
import { repositories } from './repositories.js';
const repo = repositories[0], sha = 'a'.repeat(40);
const release = { id: 'release-1', repository: repo.id, tag:'v1.2.0', sha, run:{id:123,attempt:1} };
const artifacts = () => ['amd64','arm64'].map(arch => ({ arch, status:'available', scanConclusion:'success', report:{ SchemaVersion:2, ArtifactType:'container_image', ArtifactName:`${repo.image}:${sha}-123-1-${arch}`, CreatedAt:'2026-11-06T00:00:00Z', Results:[{Target:'api',Vulnerabilities:[]}]} }));
test('both exact platform reports are required for policy success', () => {
  assert.equal(securitySummary(repo,release,artifacts()).policy,'passed');
  assert.equal(securitySummary(repo,release,artifacts().slice(0,1)).policy,'unknown');
  const a=artifacts();a[1].scanConclusion='failure';assert.equal(securitySummary(repo,release,a).policy,'unknown');
});
test('HIGH and CRITICAL including unfixed vulnerabilities fail policy with real counts', () => {
  const a=artifacts();a[0].report.Results[0].Vulnerabilities=[{VulnerabilityID:'CVE-2026-1234',PkgName:'stdlib',Severity:'HIGH',InstalledVersion:'1.0'},{Severity:'CRITICAL'}];
  const result=securitySummary(repo,release,a);assert.equal(result.policy,'failed');assert.equal(result.platforms[0].total,2);assert.equal(result.platforms[0].findings[0].fixed,'');
});
test('wrong source image and malformed reports cannot claim success', () => {
  for(const change of [{ArtifactName:'wrong'},{Results:null},{SchemaVersion:1}]){const a=artifacts();Object.assign(a[0].report,change);assert.throws(()=>securitySummary(repo,release,a));}
});
test('finding output is bounded while counts retain all findings',()=>{
 const a=artifacts();a[0].report.Results[0].Vulnerabilities=Array.from({length:501},()=>({Severity:'HIGH',Title:'x'.repeat(500)}));
 const p=securitySummary(repo,release,a).platforms[0];assert.equal(p.total,501);assert.equal(p.findings.length,500);assert.equal(p.truncated,true);assert.equal(p.findings[0].title.length,300);
});
test('security API is read-only, caches evidence and sanitizes upstream errors',async t=>{
 let calls=0, fail=false;
 const app=express();app.use('/api',createReleaseRouter({service:{get:()=>release},github:{securityReports:async()=>{calls++;if(fail)throw Error('secret-token');return artifacts();}}}));
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});t.after(()=>new Promise(resolve=>server.close(resolve)));
 const url=`http://127.0.0.1:${server.address().port}/api/security/releases/release-1`;
 let r=await fetch(url);assert.equal(r.status,200);assert.equal((await r.json()).policy,'passed');await fetch(url);assert.equal(calls,1);
 release.run.attempt=2;fail=true;r=await fetch(url);assert.equal(r.status,502);assert.ok(!(await r.text()).includes('secret-token'));release.run.attempt=1;
});
