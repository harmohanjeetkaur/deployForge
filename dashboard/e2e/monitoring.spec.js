import { test, expect } from '@playwright/test'
import { handleSession, executionConfig } from './ui-fixtures.js'
test('monitoring reports unavailable endpoints and recovers on refresh', async ({ page }) => {
  let available = false
  await page.route('**/api/**', route => {
    if (handleSession(route)) return
    const path = new URL(route.request().url()).pathname
    if (path === '/api/deploy/config') return route.fulfill({ json: executionConfig })
    if (path === '/api/monitoring/status') return route.fulfill({ json: { services: [{ name: 'Prometheus', status: available ? 'up' : 'down', url: 'http://127.0.0.1:9090', message: available ? '7/7 scrape targets UP.' : 'Start loopback port-forward.' }] } })
    return route.fulfill({ json: {} })
  })
  await page.goto('/')
  await page.getByRole('link', { name: 'Monitoring', exact: true }).click()
  await expect(page.getByText('Start loopback port-forward.')).toBeVisible()
  available = true
  await page.getByRole('button', { name: 'Refresh monitoring' }).click()
  await expect(page.getByText('7/7 scrape targets UP.')).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('link', { name: 'Open Prometheus ↗' })).toBeVisible()
})
test('observability overview renders real summary, trend and alert data without fabricated zeroes', async ({ page }) => {
  await page.route('**/api/**', route => {
    if(handleSession(route)) return
    if(new URL(route.request().url()).pathname === '/api/deploy/config') return route.fulfill({ json: executionConfig })
    return route.fulfill({ json: { services: [], checkedAt: new Date().toISOString(), summary: { ready: 3, desired: 3, probeSuccess: 1, argoSync: 'Synced', argoHealth: 'Healthy' }, targets: [{ job: 'application-probes', instance: 'http://app/readyz', health: 'up', duration: 0.01 }], trends: { availability: [[100,100],[160,100]], latency: [[100,10],[160,12]] }, alerts: null } })
  })
  await page.goto('/')
  await page.getByRole('link', { name: 'Monitoring', exact: true }).click()
  await expect(page.getByText('Healthy', {exact:true})).toBeVisible()
  await expect(page.getByRole('img', { name: 'Application availability: 2 real samples' })).toBeVisible()
  await expect(page.getByText('Alert state unavailable.')).toBeVisible()
  await expect(page.getByText('No active alerts', {exact:true})).toHaveCount(0)
  await expect(page.getByText('10.0 ms', {exact:true})).toBeVisible()
  await page.setViewportSize({width:390,height:844})
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})
test('correlates related alerts and keeps technical detail collapsed',async({page})=>{
 await page.route('**/api/**',route=>{
  if(handleSession(route))return;
  const path=new URL(route.request().url()).pathname;
  if(path==='/api/deploy/config')return route.fulfill({json:executionConfig});
  if(path==='/api/kubernetes/history')return route.fulfill({json:[]});
  if(path==='/api/monitoring/status')return route.fulfill({json:{services:[],summary:{ready:3,desired:3,probeSuccess:1},targets:[],trends:{},alerts:[{name:'DeployForgeDemoCrashLoop',pod:'startup-123456789-abcde',state:'firing',demo:true},{name:'DeployForgeDemoReadinessFailure',pod:'endpoint-123456789-abcde',state:'firing',demo:true},{name:'DeployForgeDemoHTTPProbeFailure',instance:'http://endpoint.ns.svc:8080/health',state:'firing',demo:true}],demoProbes:[{instance:'http://endpoint.ns.svc:8080/health',success:0,httpStatus:503}]}});
  return route.fulfill({json:{}});
 });
 await page.goto('/');await page.getByRole('link',{name:'Monitoring',exact:true}).click();
 await expect(page.locator('.alert-group')).toHaveCount(2);
 await expect(page.getByText('Endpoint returning errors',{exact:false})).toBeVisible();
 await expect(page.locator('.alert-source').first()).toBeHidden();
 await expect(page.locator('.endpoint-details')).not.toHaveAttribute('open');
 await page.locator('.endpoint-details summary').click();await expect(page.getByText('HTTP 503',{exact:true})).toBeVisible();
});
