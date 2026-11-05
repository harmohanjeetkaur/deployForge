import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { createGitHub, releaseEvidenceFromZip } from './github.js';
import { repositories } from './repositories.js';
import { verifyImageTag } from './registry.js';
const repo = repositories[0], sha = 'a'.repeat(40), token = 'test-server-secret';
const workflow = Buffer.from('reviewed workflow'), workflowDigest = createHash('sha256').update(workflow).digest('hex');
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
function archive(value, filename = 'release.json') {
  const content = Buffer.from(JSON.stringify(value)), packed = deflateRawSync(content), name = Buffer.from(filename);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(8, 8); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(content.length, 22); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(8, 10); central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(content.length, 24); central.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(central.length + name.length, 12); end.writeUInt32LE(local.length + name.length + packed.length, 16);
  return Buffer.concat([local, name, packed, central, name, end]);
}
test('GitHub resolves an exact branch commit and verifies operator-approved workflow bytes', async () => {
  const paths = [];
  const github = createGitHub({ token, workflowDigest, fetcher: async (url, options) => {
    assert.equal(options.headers.Authorization, `Bearer ${token}`); assert.equal(options.redirect, 'error'); paths.push(url);
    if (url.includes('/git/ref/heads/')) return json({ object: { sha } });
    if (url.includes('/contents/')) return json({ encoding: 'base64', size: workflow.length, content: workflow.toString('base64') });
    return json({ sha, commit: { message: 'source commit\nbody' } });
  } });
  assert.deepEqual(await github.source(repo, 'feature/release'), { sha, message: 'source commit' });
  assert.match(paths[0], /heads\/feature%2Frelease$/); assert.match(paths.at(-1), new RegExp(`ref=${sha}$`));
});
test('invalid or unapproved workflow commit fails before tag mutation', async () => {
  const github = createGitHub({ token, workflowDigest, fetcher: async url => url.includes('/contents/') ? json({ encoding: 'base64', content: Buffer.from('different workflow').toString('base64') }) : json({ sha }) });
  await assert.rejects(github.source(repo, sha), /operator-approved/);
  for (const ref of ['', 'has whitespace', 'x'.repeat(201), null]) await assert.rejects(github.source(repo, ref), /branch or full/);
});
test('GitHub errors are sanitized, including network errors that embed credentials', async () => {
  for (const fetcher of [async () => json({ message: token }, 403), async () => { throw new Error(token); }]) {
    const client = createGitHub({ token, fetcher });
    await assert.rejects(client.createTag(repo, 'v1.0.0', sha), error => !error.message.includes(token));
  }
});
test('tag create uses exact ref and pinned SHA, missing tag is distinguished from API failure', async () => {
  const github = createGitHub({ token, fetcher: async (_url, options) => {
    if (options.method === 'POST') { assert.deepEqual(JSON.parse(options.body), { ref: 'refs/tags/v1.0.0', sha }); return json({}, 201); }
    return json({}, 404);
  } });
  assert.equal(await github.tag(repo, 'v1.0.0'), null); await github.createTag(repo, 'v1.0.0', sha);
});
test('run tracking filters main builds, foreign repositories, wrong tags and commits; pins attempt', async () => {
  const run = { id: 123, run_attempt: 2, head_sha: sha, head_branch: 'v1.2.0', event: 'push', repository: { full_name: 'harmohanjeetkaur/deployForge' }, head_repository: { full_name: 'harmohanjeetkaur/deployForge' }, status: 'completed', conclusion: 'success' };
  const client = createGitHub({ token, fetcher: async url => {
    if (url.includes('/attempts/2/jobs')) return json({ jobs: [{ name: 'scan', conclusion: 'success', steps: [{ name: 'Security policy', conclusion: 'success' }] }] });
    assert.match(url, /actions\/workflows\/ci.yaml\/runs/);
    return json({ workflow_runs: [{ ...run, head_branch: 'main' }, { ...run, head_sha: 'b'.repeat(40) }, { ...run, head_repository: { full_name: 'attacker/repo' } }, run] });
  } });
  const found = await client.run(repo, { sha, tag: 'v1.2.0' }); assert.equal(found.attempt, 2); assert.equal(found.jobs[0].steps[0].name, 'Security policy');
});
test('ambiguous workflow runs fail closed', async () => {
  const run = { head_sha: sha, head_branch: 'v1.2.0', event: 'push', repository: { full_name: 'harmohanjeetkaur/deployForge' }, head_repository: { full_name: 'harmohanjeetkaur/deployForge' } };
  const client = createGitHub({ token, fetcher: async () => json({ workflow_runs: [run, run] }) });
  await assert.rejects(client.run(repo, { sha, tag: 'v1.2.0' }), /Multiple/);
});
test('evidence download pins artifact/run/attempt and digest; storage receives no credential', async () => {
  const value = { sha, digest: 'image-digest' }, zip = archive(value), digest = `sha256:${createHash('sha256').update(zip).digest('hex')}`;
  const client = createGitHub({ token, fetcher: async (url, options) => {
    if (url.includes('/runs/123/artifacts')) return json({ artifacts: [{ id: 456, name: 'release-evidence-123-2', expired: false, size_in_bytes: zip.length, digest }] });
    if (url.includes('/artifacts/456/zip')) { assert.equal(options.redirect, 'manual'); return new Response(null, { status: 302, headers: { Location: 'https://results.blob.core.windows.net/signed' } }); }
    assert.equal(options.headers, undefined); return new Response(zip);
  } });
  assert.deepEqual(await client.evidence(repo, { id: 123, attempt: 2 }), value);
});
test('unexpected artifact redirects and corrupted archive digests are refused', async () => {
  for (const location of ['https://attacker.example/steal', 'http://results.blob.core.windows.net/file']) {
    const client = createGitHub({ token, fetcher: async url => url.endsWith('/zip') ? new Response(null, { status: 302, headers: { Location: location } }) : json({ artifacts: [{ id: 456, name: 'release-evidence-123-1', size_in_bytes: 10 }] }) });
    await assert.rejects(client.evidence(repo, { id: 123, attempt: 1 }), /Unexpected/);
  }
  const client = createGitHub({ token, fetcher: async url => url.endsWith('/zip') ? new Response(archive({})) : json({ artifacts: [{ id: 456, name: 'release-evidence-123-1', size_in_bytes: 10, digest: `sha256:${'0'.repeat(64)}` }] }) });
  await assert.rejects(client.evidence(repo, { id: 123, attempt: 1 }), /digest mismatch/);
});
test('ZIP parsing is bounded and never extracts arbitrary paths', () => {
  assert.deepEqual(releaseEvidenceFromZip(archive({ sha })), { sha });
  assert.throws(() => releaseEvidenceFromZip(Buffer.alloc(1024 * 1024 + 1)), /too large/);
  assert.throws(() => releaseEvidenceFromZip(Buffer.from('invalid')), /Invalid/);
  const changed = archive({ sha }); changed.writeUInt32LE(0xffffffff, changed.length - 6);
  assert.throws(() => releaseEvidenceFromZip(changed));
});
test('strict registry verification hashes the actual manifest rather than trusting a digest header', async () => {
  const body = JSON.stringify({ manifests: [{ platform: { os: 'linux', architecture: 'amd64' } }, { platform: { os: 'linux', architecture: 'arm64' } }] });
  const correct = `sha256:${createHash('sha256').update(body).digest('hex')}`;
  for (const header of [correct, `sha256:${'0'.repeat(64)}`]) {
    const result = await verifyImageTag(sha, async () => new Response(body, { headers: { 'docker-content-digest': header } }), true);
    assert.equal(result.exists, header === correct); if (result.exists) assert.equal(result.digest, correct);
  }
});

test('security artifacts pin run, attempt, architecture and checksum without forwarding credentials', async () => {
  const release = { sha, tag: 'v1.2.0', run: { id: 123, attempt: 2 } };
  const zips = Object.fromEntries(['amd64','arm64'].map(arch => [arch, archive({ ArtifactName: arch }, `trivy-${arch}.json`)]));
  const client = createGitHub({ token, fetcher: async (url, options) => {
    if (url.includes('/attempts/2/jobs')) return json({ jobs: ['amd64','arm64'].map(arch => ({ name: `Build and scan (${arch})`, steps: [{ name: 'Security policy', conclusion: 'success' }] })) });
    if (url.includes('/attempts/2')) return json({ id: 123, run_attempt: 2, head_sha: sha, head_branch: release.tag, event: 'push', path: '.github/workflows/ci.yaml', repository: { full_name: 'harmohanjeetkaur/deployForge' }, head_repository: { full_name: 'harmohanjeetkaur/deployForge' } });
    if (url.includes('/runs/123/artifacts')) return json({ artifacts: ['amd64','arm64'].map((arch,i) => ({ id: i+1, name: `security-123-2-${arch}`, size_in_bytes: zips[arch].length, digest: `sha256:${createHash('sha256').update(zips[arch]).digest('hex')}` })) });
    if (url.includes('/artifacts/')) return new Response(null, { status: 302, headers: { Location: `https://results.blob.core.windows.net/${url.includes('/1/') ? 'amd64' : 'arm64'}` } });
    assert.equal(options.headers, undefined);
    return new Response(zips[url.endsWith('amd64') ? 'amd64' : 'arm64']);
  } });
  const result = await client.securityReports(repo, release);
  assert.deepEqual(result.map(r => r.arch), ['amd64','arm64']);
  assert.ok(result.every(r => r.scanConclusion === 'success'));
});
test('security evidence refuses a foreign run before downloading artifacts', async () => {
  const client = createGitHub({ token, fetcher: async () => json({ id: 123, run_attempt: 2, head_sha: 'b'.repeat(40) }) });
  await assert.rejects(client.securityReports(repo, { sha, tag: 'v1.2.0', run: { id:123,attempt:2 } }), /provenance/);
});
