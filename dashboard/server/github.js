import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';

export class GitHubError extends Error {
  constructor(status) { super(`GitHub API returned HTTP ${status}; check permissions, rate limits and repository access`); this.status = status; this.statusCode = status === 404 ? 404 : 502; }
}
const enc = encodeURIComponent;
const sha = value => /^[a-f0-9]{40}$/.test(value);
// Parse only a bounded release.json entry; never extract archive paths to disk.
export function releaseEvidenceFromZip(bytes) { return jsonArtifactFromZip(bytes); }
export function jsonArtifactFromZip(bytes, filename = 'release.json', maxArchive = 1024 * 1024, maxJson = 65536) {
  if (bytes.length > maxArchive) throw new Error('Release evidence is too large');
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (bytes.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new Error('Invalid release evidence archive');
  let offset = bytes.readUInt32LE(end + 16), result;
  const count = bytes.readUInt16LE(end + 10);
  if (count > 10) throw new Error('Unexpected release evidence archive');
  for (let i = 0; i < count; i++) {
    if (bytes.readUInt32LE(offset) !== 0x02014b50) throw new Error('Invalid release evidence directory');
    const flags = bytes.readUInt16LE(offset + 8), method = bytes.readUInt16LE(offset + 10);
    const size = bytes.readUInt32LE(offset + 20), expanded = bytes.readUInt32LE(offset + 24);
    const length = bytes.readUInt16LE(offset + 28), extra = bytes.readUInt16LE(offset + 30), comment = bytes.readUInt16LE(offset + 32);
    const name = bytes.subarray(offset + 46, offset + 46 + length).toString();
    if (name === filename) {
      if (result || flags & 1 || expanded > maxJson || ![0, 8].includes(method)) throw new Error('Unsafe release evidence');
      const local = bytes.readUInt32LE(offset + 42);
      if (bytes.readUInt32LE(local) !== 0x04034b50) throw new Error('Invalid evidence entry');
      const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
      if (start + size > bytes.length) throw new Error('Truncated evidence entry');
      const packed = bytes.subarray(start, start + size);
      const content = method === 8 ? inflateRawSync(packed, { maxOutputLength: maxJson }) : packed;
      if (content.length !== expanded) throw new Error('Invalid evidence size');
      result = JSON.parse(content.toString());
    }
    offset += 46 + length + extra + comment;
  }
  if (!result) throw new Error(`${filename} is missing`);
  return result;
}

export function createGitHub({ token, fetcher = fetch, workflowDigest } = {}) {
  async function request(path, { method = 'GET', body, redirect = 'error' } = {}) {
    if (!token) throw new Error('Server GitHub authentication is not configured');
    let response;
    try {
      response = await fetcher(`https://api.github.com${path}`, { method, redirect, signal: AbortSignal.timeout(15000),
        headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}) });
    } catch { throw new Error('GitHub request unavailable or timed out; retry reconciliation'); }
    if (!response.ok && response.status !== 302) throw new GitHubError(response.status);
    return response;
  }
  const base = r => `/repos/${enc(r.owner)}/${enc(r.repo)}`;
  const json = async path => (await request(path)).json();
  async function downloadArtifact(r, artifact, limit = 1024 * 1024) {
      const response = await request(`${base(r)}/actions/artifacts/${artifact.id}/zip`, { redirect: 'manual' });
      let download = response;
      if (response.status === 302) {
        const url = new URL(response.headers.get('location'));
        if (url.protocol !== 'https:' || url.username || url.password || !(url.hostname.endsWith('.blob.core.windows.net') || url.hostname.endsWith('.actions.githubusercontent.com'))) throw new Error('Unexpected artifact download host');
        // Signed storage redirect receives no GitHub Authorization header.
        download = await fetcher(url.href, { redirect: 'error', signal: AbortSignal.timeout(15000) });
      }
      if (!download.ok) throw new Error('Unable to download release evidence');
      const chunks = []; let size = 0;
      for await (const chunk of download.body) { size += chunk.length; if (size > limit) throw new Error('Release evidence is too large'); chunks.push(chunk); }
      const bytes = Buffer.concat(chunks);
      if (!/^sha256:[a-f0-9]{64}$/.test(artifact.digest || '') || `sha256:${createHash('sha256').update(bytes).digest('hex')}` !== artifact.digest) throw new Error('Release evidence archive digest mismatch');
      return bytes;
  }
  return {
    async source(r, ref) {
      if (typeof ref !== 'string' || ref.length > 200 || !ref || /\s/.test(ref) || [...ref].some(c => c.charCodeAt(0) < 32)) throw Object.assign(new Error('Enter a branch or full commit SHA'), { statusCode: 400 });
      // Resolve branches explicitly; reject ambiguous shorthand, tags and revision expressions.
      const commit = sha(ref) ? ref : (await json(`${base(r)}/git/ref/heads/${enc(ref)}`)).object?.sha;
      const data = await json(`${base(r)}/commits/${enc(commit || '')}`);
      if (!sha(data.sha) || (sha(ref) && data.sha !== ref)) throw new Error('Source commit could not be verified');
      if (!workflowDigest) throw new Error('Approved workflow fingerprint is not configured');
      const workflow = await json(`${base(r)}/contents/.github/workflows/${enc(r.workflow)}?ref=${data.sha}`);
      if (workflow.encoding !== 'base64' || workflow.size > 65536 || createHash('sha256').update(Buffer.from(workflow.content || '', 'base64')).digest('hex') !== workflowDigest) {
        throw Object.assign(new Error('Selected commit does not contain the operator-approved release workflow'), { statusCode: 400 });
      }
      return { sha: data.sha, message: String(data.commit?.message || '').split('\n')[0].slice(0, 200) };
    },
    async sources(r) {
      const branches = await json(`${base(r)}/branches?per_page=100`);
      return branches.map(b => ({ branch: b.name, sha: b.commit.sha }));
    },
    async tag(r, tag) {
      try { const data = await json(`${base(r)}/git/ref/tags/${enc(tag)}`); return data.object?.type === 'commit' ? data.object.sha : 'annotated-or-invalid'; }
      catch (error) { if (error.status === 404) return null; throw error; }
    },
    async createTag(r, tag, commit) { await request(`${base(r)}/git/refs`, { method: 'POST', body: { ref: `refs/tags/${tag}`, sha: commit } }); },
    async run(r, release) {
      // Filter the configured workflow, exact tag, SHA, push event and source repository.
      const data = await json(`${base(r)}/actions/workflows/${enc(r.workflow)}/runs?${new URLSearchParams({ event: 'push', head_sha: release.sha, branch: release.tag, per_page: '100' })}`);
      const matches = data.workflow_runs.filter(run => run.head_sha === release.sha && run.head_branch === release.tag && run.event === 'push'
        && run.repository?.full_name?.toLowerCase() === `${r.owner}/${r.repo}`.toLowerCase()
        && run.head_repository?.full_name?.toLowerCase() === `${r.owner}/${r.repo}`.toLowerCase());
      if (matches.length > 1) throw new Error('Multiple workflow runs match this release; operator review required');
      if (!matches.length) return null;
      const run = matches[0];
      const jobs = await json(`${base(r)}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`);
      return { id: run.id, attempt: run.run_attempt, url: `https://github.com/${r.owner}/${r.repo}/actions/runs/${run.id}`,
        status: run.status, conclusion: run.conclusion, jobs: jobs.jobs.map(j => ({ name: j.name, conclusion: j.conclusion, steps: (j.steps || []).map(s => ({ name: s.name, conclusion: s.conclusion })) })) };
    },
    async securityReports(r, release) {
      const run = release.run;
      if (!Number.isSafeInteger(run?.id) || run.id < 1 || !Number.isSafeInteger(run.attempt) || run.attempt < 1 || !sha(release.sha)) throw new Error('Release workflow has not been discovered');
      const actual = await json(`${base(r)}/actions/runs/${run.id}/attempts/${run.attempt}`);
      const fullName = `${r.owner}/${r.repo}`.toLowerCase();
      if (actual.id !== run.id || actual.run_attempt !== run.attempt || actual.head_sha !== release.sha || actual.head_branch !== release.tag
        || actual.event !== 'push' || actual.repository?.full_name?.toLowerCase() !== fullName
        || actual.head_repository?.full_name?.toLowerCase() !== fullName || actual.path?.split('@')[0] !== `.github/workflows/${r.workflow}`) throw new Error('Security workflow provenance mismatch');
      const jobs = await json(`${base(r)}/actions/runs/${run.id}/attempts/${run.attempt}/jobs?per_page=100`);
      const data = await json(`${base(r)}/actions/runs/${run.id}/artifacts?per_page=100`);
      return Promise.all(['amd64', 'arm64'].map(async arch => {
        const found = data.artifacts.filter(a => a.name === `security-${run.id}-${run.attempt}-${arch}`);
        if (!found.length || found[0].expired) return { arch, status: 'unavailable', message: 'Report missing or expired' };
        if (found.length !== 1 || found[0].size_in_bytes > 8 * 1024 * 1024) throw new Error('Ambiguous or oversized security evidence');
        const bytes = await downloadArtifact(r, found[0], 8 * 1024 * 1024);
        const report = jsonArtifactFromZip(bytes, `trivy-${arch}.json`, 8 * 1024 * 1024, 16 * 1024 * 1024);
        const job = jobs.jobs.find(j => j.name === `Build and scan (${arch})`);
        const scan = job?.steps?.find(step => step.name === 'Security policy');
        return { arch, status: 'available', scanConclusion: scan?.conclusion || null, report };
      }));
    },
    async evidence(r, run) {
      const data = await json(`${base(r)}/actions/runs/${run.id}/artifacts?per_page=100`);
      const found = data.artifacts.filter(a => a.name === `release-evidence-${run.id}-${run.attempt}` && !a.expired);
      if (found.length !== 1 || found[0].size_in_bytes > 1024 * 1024) throw new Error('CI release evidence missing, expired or ambiguous');
      const artifact = found[0];
      const bytes = await downloadArtifact(r, artifact);
      return releaseEvidenceFromZip(bytes);
    },
  };
}
