import { refreshSessionFixture } from './ui-fixtures.js'
import { handleSession } from './ui-fixtures.js'
import { test, expect } from '@playwright/test'
import { executionConfig } from './ui-fixtures.js'
const current = 'a'.repeat(40), target = 'b'.repeat(40)
const repo = 'ghcr.io/harmohanjeetkaur/deployforge'
for (const operation of ['deploy', 'rollback']) {
  for (const code of [401, 403]) test(`${operation}: ${code} is authorization rejection, recovery sends the correct authenticated request`, async ({ page }) => {
    let submissions = 0
    await page.route('**/api/**', async route => {
    if (handleSession(route)) return;
    if (new URL(route.request().url()).pathname === '/api/releases') return route.fulfill({ json: { releases: [] } })
    if (new URL(route.request().url()).pathname === '/api/repositories') return route.fulfill({ json: { repositories: [] } })
      const request = route.request(), path = new URL(request.url()).pathname
      let json
      if (path === '/api/deploy/config') json = executionConfig
      else if (path === '/api/kubernetes/status') json = { currentImage: `${repo}:${current}`, readyReplicas: 3, desiredReplicas: 3, pods: [] }
      else if (path === '/api/kubernetes/history') json = [{ revision: '6', deploymentRevision: '7', containerImage: `${repo}:${target}`, rollbackEligible: true, isCurrent: false }]
      else if (path.startsWith('/api/images/verify/')) json = { valid: true, exists: true, platformsSupported: true, platforms: ['linux/amd64', 'linux/arm64'] }
      else if (path === `/api/${operation}`) {
        submissions++
        expect(request.headers().origin).toBe('http://localhost:5173')
      expect(route.request().headers()['x-csrf-token']).toBe('test-csrf')
        expect(request.postDataJSON()).toEqual({ tag: target, execution: 'real', environment: 'docker-desktop' })
        if (submissions === 1) return route.fulfill({ status: code, json: { message: code === 401 ? 'Local session expired' : 'Forbidden origin' } })
        json = { id: 'mock-authorized-job', operation, tag: target, dryRun: false, state: 'succeeded', success: true, stage: 'healthy', commit: 'c'.repeat(40), pushed: true, progress: { requestAccepted: true, commitCreated: true, argoSynced: true, rolloutReady: true, healthy: true } }
      } else throw new Error(`Unexpected API ${path}`)
      return route.fulfill({ json })
    })
    await page.goto('/')
    await page.getByRole('link', { name: 'Deployments', exact: true }).click()
    if (operation === 'rollback') await page.getByRole('button', { name: 'Roll back a version', exact: true }).click()
    await page.locator('#version-select').selectOption(operation === 'rollback' ? 'k8s-6' : `ghcr-history-${target}`)
    await page.getByRole('button', { name: 'Verify Image Availability', exact: true }).click()
    await expect(page.getByText('✓ Image verified in GHCR', { exact: true })).toBeVisible()

    const confirm = async () => {
      await page.getByTestId('rollback-action').click()
      await page.getByRole('button', { name: operation === 'rollback' ? 'Confirm Rollback' : 'Confirm Deploy', exact: true }).click()
    }
    await confirm()
    await expect(page.getByRole('status')).toHaveText('Authorization required')
    await expect(page.locator('.preview-error')).toContainText('Authorization error')
    await expect(page.locator('.step-failed')).toHaveCount(0)
    await expect(page.locator('.step-complete')).toHaveCount(0)
    await expect(page.getByText(operation === 'rollback' ? 'Rollback failed' : 'Deployment failed', { exact: true })).toHaveCount(0)
  await expect(page.locator('input[type=password]')).toHaveCount(0)
    await refreshSessionFixture(page, true)
    await confirm()
    await expect(page.getByRole('status')).toHaveText(operation === 'rollback' ? 'Rollback healthy' : 'Deployment healthy')
    await expect(page.locator('.step-complete')).toHaveCount(5)
    expect(submissions).toBe(2)
  })
}
