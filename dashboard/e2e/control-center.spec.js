import { test, expect } from '@playwright/test'
import { executionConfig } from './ui-fixtures.js'
const image = `ghcr.io/harmohanjeetkaur/deployforge:${'a'.repeat(40)}`
async function setup(page, { replicas = 3, failure = false, monitoring = false } = {}) {
  await page.route('**/api/**', route => {
    expect(route.request().method()).toBe('GET')
    const path = new URL(route.request().url()).pathname
    if (path === '/api/deploy/config') return route.fulfill({ json: executionConfig })
    if (path === '/api/kubernetes/history') return route.fulfill({ json: [] })
    if (path === '/api/monitoring/status') return route.fulfill(monitoring ? { json: { services: [{ name: 'Prometheus', status: 'up', url: 'http://127.0.0.1:9090' }, { name: 'Grafana', status: 'down', url: 'https://example.com' }] } } : { status: 404, json: {} })
    if (path === '/api/kubernetes/status') return route.fulfill(failure ? { status: 500, json: {} } : { json: { deploymentName: 'deployforge', namespace: 'deployforge-gitops', currentImage: image, desiredReplicas: replicas, readyReplicas: replicas, updatedReplicas: replicas, availableReplicas: replicas, revision: '7', pods: replicas ? [{ name: 'pod-one', status: 'Running', ready: '1/1', restarts: 0, node: 'docker-desktop' }, { name: 'pod-two', status: 'Pending', ready: '0/1', restarts: 1, reason: 'ImagePullBackOff' }] : [], argo: { application: 'deployforge', sync: 'OutOfSync', health: 'Degraded', revision: 'b'.repeat(40), operation: 'Failed' } } })
    throw new Error(`Unexpected GET ${path}`)
  })
  await page.goto('/')
}
test('overview separates replica readiness from live ArgoCD health and shows pod diagnostics', async ({ page }) => {
  await setup(page)
  await expect(page.getByRole('heading', { name: 'Your platform, at a glance' })).toBeVisible()
  await expect(page.getByText('OutOfSync', { exact: true })).toBeVisible()
  await expect(page.locator('.release-image')).toContainText('a'.repeat(40))
  await expect(page.getByText('#7', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Kubernetes', exact: true }).click()
  await expect(page.locator('.pod-card')).toHaveCount(2)
  await expect(page.getByText('ImagePullBackOff', { exact: true })).toBeVisible()
  await expect(page.locator('.command-block')).toContainText('--context docker-desktop -n deployforge-gitops')
})
test('zero replicas and empty pods are not presented as a healthy running workload', async ({ page }) => {
  await setup(page, { replicas: 0 })
  await expect(page.getByText('Deployment is scaled to zero')).toBeVisible()
  await expect(page.getByText('No pods reported for this deployment.')).toBeVisible()
  await expect(page.getByText('All desired replicas are ready')).toHaveCount(0)
})
test('connection failures and security data absence are explicit', async ({ page }) => {
  await setup(page, { failure: true })
  await expect(page.getByRole('alert').filter({ hasText: 'Live data unavailable' })).toContainText('Live data unavailable')
  await page.getByRole('link', { name: 'Security', exact: true }).click()
  await expect(page.getByText('Security results unavailable')).toBeVisible()
  await expect(page.getByText('Not evaluated', { exact: true })).toBeVisible()
  await expect(page.getByText('Demo Mode')).toHaveCount(0)
  await page.getByRole('link', { name: 'Monitoring', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Monitoring backend is not configured')
})
test('monitoring shows backend service status and exposes only safe local links', async ({ page }) => {
  await setup(page, { monitoring: true })
  await page.getByRole('link', { name: 'Monitoring', exact: true }).click()
  await expect(page.getByRole('link', { name: 'Open Prometheus' })).toHaveAttribute('href', 'http://127.0.0.1:9090/')
  await expect(page.getByRole('link', { name: 'Open Grafana' })).toHaveCount(0)
  await expect(page.getByText('down', { exact: true })).toBeVisible()
})
test('mobile overview and pod cards remain within viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await setup(page)
  await expect(page.getByRole('heading', { name: 'Your platform, at a glance' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  await page.getByRole('link', { name: 'Kubernetes', exact: true }).click()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
})
