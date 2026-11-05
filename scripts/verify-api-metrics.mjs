// Read-only post-rollout check. Not run against the current uninstrumented image.
// Uses ephemeral loopback forwards and GET-only traffic, never deployment APIs.
import { execFileSync, spawn } from 'node:child_process';
const base = ['--context', 'docker-desktop', '-n', 'deployforge-gitops'];
const data = JSON.parse(execFileSync('kubectl', [...base, 'get', 'pods', '-l', 'app.kubernetes.io/name=deployforge', '-o', 'json'], { encoding: 'utf8' }));
if (data.items.length !== 3 || data.items.some(p => p.status.phase !== 'Running' || !p.status.containerStatuses?.every(c => c.ready))) throw Error('Expected three Running/Ready DeployForge pods');
for (const pod of data.items) {
  const forward = spawn('kubectl', [...base, 'port-forward', '--address', '127.0.0.1', 'pod/' + pod.metadata.name, ':8080'], { stdio: ['ignore', 'pipe', 'ignore'] });
  try {
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Loopback forward timed out')), 10000);
      forward.once('error', () => { clearTimeout(timer); reject(Error('Could not start loopback forward')); });
      forward.once('exit', () => { clearTimeout(timer); reject(Error('Loopback forward closed')); });
      forward.stdout.on('data', chunk => { const match = chunk.toString().match(/Forwarding from 127\.0\.0\.1:(\d+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
    });
    const url = `http://127.0.0.1:${port}`;
    async function scrape() {
      const r = await fetch(url + '/metrics', { signal: AbortSignal.timeout(3000), redirect: 'error' });
      if (!r.ok || !/^(text\/plain|application\/openmetrics-text)/.test(r.headers.get('content-type') || '')) throw Error('No Prometheus endpoint; do not enable scraping');
      const text = await r.text();
      if (!/^deployforge_http_requests_in_flight(?:\{| )/m.test(text)) throw Error('Instrumented metric missing; do not enable scraping');
      return text;
    }
    await scrape();
    const request = await fetch(url + '/', { signal: AbortSignal.timeout(3000), redirect: 'error' });
    await request.arrayBuffer();
    if (!request.ok) throw Error('Application GET failed');
    const text = await scrape();
    if (!text.includes('deployforge_http_requests_total{') || !text.includes('deployforge_http_request_duration_seconds_bucket{')) throw Error('Request samples missing');
    console.log(`PASS ${pod.metadata.name}: real request, status, duration and in-flight samples`);
  } finally { forward.kill('SIGTERM'); }
}
