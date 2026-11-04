import { handleSession } from './ui-fixtures.js'
import { test, expect } from '@playwright/test'
import { executionConfig } from './ui-fixtures.js'
const image = `ghcr.io/harmohanjeetkaur/deployforge:${'a'.repeat(40)}`
test('focus recovers configuration and displays actual process operation after reload', async ({ page }) => {
  let available = false
  const job = { id: 'observed', operation: 'rollback', state: 'succeeded', dryRun: false, success: true, stage: 'healthy', commit: 'c'.repeat(40), startedAt: '2026-11-04T13:00:00Z', progress: { requestAccepted: true, commitCreated: true, argoSynced: true, rolloutReady: true, healthy: true } }
  await page.route('**/api/**', route => {
    if (handleSession(route)) return;
    const path = new URL(route.request().url()).pathname
    expect(route.request().method()).toBe('GET')
    if (path === '/api/deploy/config') return route.fulfill({ status: available ? 200 : 503, json: available ? { ...executionConfig, latestOperation: job } : {} })
    return route.fulfill({ json: path.endsWith('/history') ? [] : { currentImage: image, pods: [], desiredReplicas: 3, readyReplicas: 3 } })
  })
  await page.goto('/')
  await page.getByRole('link', { name: 'Deployments', exact: true }).click()
  await expect(page.getByTestId('execution-status')).toContainText('Cannot confirm backend readiness')
  available = true
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.locator('.backend-readiness')).toContainText('Execution enabled')
  await expect(page.getByRole('status')).toHaveText('Rollback healthy')
  await expect(page.locator('.step-complete')).toHaveCount(5)
  await expect(page.locator('.commit-reference')).toContainText(job.commit)
  await expect(page.getByText(/Last rollback/)).toContainText('11/4/2026')
  await page.reload()
  await page.getByRole('link', { name: 'Deployments', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('Rollback healthy')
  await expect(page.locator('input[type=password]')).toHaveCount(0)
  available = false
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.getByTestId('execution-status')).toContainText('Cannot confirm backend readiness')
  await expect(page.getByTestId('rollback-action')).toBeEnabled()
})
