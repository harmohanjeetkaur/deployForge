// Capture an existing local dashboard. All release/deployment/rollback writes are blocked.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium } from '../dashboard/node_modules/playwright/index.mjs';
if (process.env.DEPLOYFORGE_CAPTURE_UI !== '1') throw Error('Opt in with DEPLOYFORGE_CAPTURE_UI=1');
const directory = fileURLToPath(new URL('../docs/images/', import.meta.url));
await mkdir(directory, { recursive: true });
const authorize = process.env.DEPLOYFORGE_CAPTURE_LOCAL_ANALYSIS === '1';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const receipt = { capturedAt: new Date().toISOString(), pages: [], blockedWrites: 0, operationsSubmitted: 0 };
let context;
try {
  context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await context.newPage();
  const faults = [];
  page.on('pageerror', e => faults.push(e.message));
  const allowed = new Set(['/api/session/request', '/api/session/logout', '/api/incidents/evidence', '/api/incidents/analyze']);
  await page.route('**/api/**', route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (!authorize && path.startsWith('/api/session')) return route.fulfill({ json: { state: 'none' } });
    if (request.method() !== 'GET' && !(authorize && allowed.has(path))) {
      receipt.blockedWrites++; return route.fulfill({ status: 403, json: { message: 'Documentation capture is read-only' } });
    }
    return route.continue();
  });
  if (authorize) {
    const provider = await fetch('http://127.0.0.1:3001/api/incidents').then(r => r.json());
    if (provider.ai?.provider !== 'Local analysis') throw Error('Local analysis must be explicitly configured; external model requests are forbidden');
  }
  await page.goto('http://localhost:5173');
  if (authorize) {
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await page.locator('[aria-label="Local browser connection"] code').waitFor();
    const approvalId = await page.locator('[aria-label="Local browser connection"] code').innerText();
    const token = (await readFile(`${homedir()}/.deployforge-secrets/deploy-token`, 'utf8')).trim();
    const response = await fetch('http://127.0.0.1:3001/api/session/approve', { method: 'POST', headers: { Origin: 'http://localhost:5173', 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ approvalId }) });
    if (!response.ok) throw Error('Capture browser approval failed');
    await page.getByRole('button', { name: 'Refresh connection', exact: true }).click();
    await page.locator('.environment-chip').getByText('Local session connected', { exact: false }).waitFor();
  }
  for (const [name, filename] of [
    ['Overview', 'overview-dashboard.png'], ['Create Release', 'create-release-dashboard.png'],
    ['Deployments', 'deployments-dashboard.png'], ['Security', 'security-dashboard.png'],
    ['Monitoring', 'monitoring-dashboard.png'], ['AI Troubleshooting', 'ai-troubleshooting-dashboard.png'],
    ['Settings', 'settings-dashboard.png'],
  ]) {
    await page.getByRole('link', { name, exact: true }).click();
    if (name === 'Security') await page.locator('.security-summary, .security-state[role="alert"]').first().waitFor({ timeout: 65000 });
    if (name === 'Monitoring') await page.locator('.obs-summary').waitFor();
    if (name === 'Overview') await page.locator('.incident-monitor').waitFor();
    if (name === 'Create Release') await page.locator('.release-history article').first().waitFor();
    if (name === 'AI Troubleshooting') await page.locator('.incident-provider').waitFor();
    await page.waitForTimeout(700);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: directory + filename, fullPage: true });
    const errors = await page.getByRole('alert').allTextContents();
    receipt.pages.push({ page: name, file: filename, errors });
    console.log(`Captured ${name}${errors.length ? ' (current unavailable state preserved)' : ''}`);
    if (name === 'Deployments') {
      await page.getByRole('button', { name: 'Roll back a version', exact: true }).click();
      await page.screenshot({ path: directory + 'rollback-dashboard.png', fullPage: true });
      receipt.pages.push({ page: 'Rollback', file: 'rollback-dashboard.png' });
    }
    if (name === 'AI Troubleshooting' && authorize) {
      await page.getByRole('button', { name: 'Collect pod evidence', exact: true }).click();
      await page.getByRole('checkbox').check();
      await page.getByRole('button', { name: 'Analyze workload', exact: true }).click();
      await page.getByRole('heading', { name: 'Workload diagnosis', exact: true }).waitFor();
      await page.screenshot({ path: directory + 'ai-troubleshooting-analysis.png', fullPage: true });
      receipt.pages.push({ page: 'Local workload diagnosis', file: 'ai-troubleshooting-analysis.png', source: 'Actual local rule-based analysis of captured Kubernetes evidence' });
    }
  }
  receipt.pageErrors = faults;
  if (faults.length) throw Error('Browser JavaScript errors detected');
} finally {
  if (authorize && context) {
    const session = await context.request.get('http://localhost:5173/api/session').then(r => r.json());
    const logout = await context.request.post('http://localhost:5173/api/session/logout', { headers: { Origin: 'http://localhost:5173', 'X-CSRF-Token': session.csrf || '' }, data: {} });
    receipt.captureSessionDisconnected = logout.ok();
  }
  await browser.close();
  await writeFile(directory + 'capture-receipt.json', JSON.stringify(receipt, null, 2) + '\n');
}
