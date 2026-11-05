// Run from any directory with the local dashboard/backend already running.
// No server, infrastructure, authentication approval or deployment is started.
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '../dashboard/node_modules/playwright/index.mjs';
if (process.env.DEPLOYFORGE_CAPTURE_UI !== '1') throw Error('Opt in with DEPLOYFORGE_CAPTURE_UI=1; captures use an already running local dashboard.');
const directory = fileURLToPath(new URL('../docs/images/', import.meta.url));
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  let blockedWrites = 0;
  await page.route('**/api/**', route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    // No live browser approval is requested or represented as connected.
    if (path.startsWith('/api/session')) return route.fulfill({ json: { state: 'pending', approvalId: '00000000' } });
    if (request.method() !== 'GET') { blockedWrites++; return route.fulfill({ status: 403, json: { message: 'Documentation capture is read-only' } }); }
    return route.continue();
  });
  await page.goto('http://localhost:5173');
  const pages = [
    ['Overview', 'overview-dashboard.png', '/api/kubernetes/status'],
    ['Create Release', 'create-release-dashboard.png', '/api/releases'],
    ['Deployments', 'deployments-dashboard.png', '/api/releases'],
    ['Security', 'security-dashboard.png', '/api/security/releases/'],
    ['Monitoring', 'monitoring-dashboard.png', '/api/monitoring/status'],
    ['Settings', 'settings-dashboard.png', '/api/deploy/config'],
  ];
  for (const [name, filename, endpoint] of pages) {
    const response = page.waitForResponse(r => r.url().includes(endpoint) && r.request().method() === 'GET', { timeout: 60000 });
    await page.getByRole('link', { name, exact: true }).click();
    const result = await response;
    if (!result.ok()) throw Error(`${name}: API returned ${result.status()}; capture stopped rather than recording success`);
    if (name === 'Security') await page.getByText(/Release meets security policy|Security findings need attention|More evidence is needed/).waitFor();
    if (name === 'Create Release') await page.locator('.release-history article').first().waitFor();
    if (name === 'Monitoring') await page.locator('.obs-summary').waitFor();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    if (name === 'Settings') await page.evaluate(() => {
      // The synthetic pending-session code is not a real approval and is omitted.
      document.querySelector('[aria-label="Local browser connection"]')?.querySelectorAll('.field-caption, code, pre').forEach(element => element.remove());
    });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `${directory}${filename}`, fullPage: true });
    console.log(`Captured ${name}: docs/images/${filename}`);
  }
  console.log(`Live operation writes submitted: 0. Blocked non-GET requests: ${blockedWrites}. Browser authorization is stubbed as pending; no credentials or connection codes captured.`);
} finally { await browser.close(); }
