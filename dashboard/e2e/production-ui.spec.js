import { refreshSessionFixture } from './ui-fixtures.js'
import { handleSession } from './ui-fixtures.js'
import { test, expect } from '@playwright/test'
import { executionConfig } from './ui-fixtures.js'
const repo = 'ghcr.io/harmohanjeetkaur/deployforge'
const current = '210426be6d6da6c2e16f234db410f83a0c98bbd2'
const target = '5b6d2c0589ab9e4a6dedbde072a95ccf124921aa'
const healthy = { id: 'real-intent-job', operation: 'deploy', tag: target, dryRun: false, success: true, state: 'succeeded', stage: 'healthy', pushed: true, commit: 'c'.repeat(40), progress: { requestAccepted: true, commitCreated: true, argoSynced: true, rolloutReady: true, healthy: true } }
async function setup(page, { config = executionConfig, post = route => route.fulfill({ json: healthy }), status } = {}) {
  let requests = 0
  await page.route('**/api/**', async route => {
    if (handleSession(route)) return;
    if (new URL(route.request().url()).pathname === '/api/releases') return route.fulfill({ json: { releases: [] } })
    if (new URL(route.request().url()).pathname === '/api/repositories') return route.fulfill({ json: { repositories: [] } })
    const path = new URL(route.request().url()).pathname
    let json
    if (path === '/api/deploy/config') json = config
    else if (path === '/api/kubernetes/status') json = { currentImage: `${repo}:${current}`, desiredReplicas: 3, readyReplicas: 3, namespace: 'deployforge-gitops', pods: [] }
    else if (path === '/api/kubernetes/history') json = [{ revision: '4', deploymentRevision: '5', containerImage: `${repo}:${target}`, isCurrent: false, rollbackEligible: true }]
    else if (path.startsWith('/api/images/verify/')) json = { valid: true, exists: true, platformsSupported: true, platforms: ['linux/amd64', 'linux/arm64'] }
    else if (['/api/deploy', '/api/rollback'].includes(path)) {
      requests++
      expect(route.request().postDataJSON()).toEqual({ tag: target, execution: 'real', environment: 'docker-desktop' })
      return post(route, requests)
    } else if (path.startsWith('/api/deploy/status/')) return status(route)
    else throw new Error(`Unexpected API ${path}`)
    return route.fulfill({ json })
  })
  await page.goto('/')
  await page.getByRole('link', { name: 'Deployments', exact: true }).click()
  await page.locator('#version-select').selectOption(`ghcr-history-${target}`)
  await page.getByRole('button', { name: 'Verify Image Availability', exact: true }).click()
  await expect(page.getByText('✓ Image verified in GHCR', { exact: true })).toBeVisible()
  return { count: () => requests }
}
async function confirm(page, operation = 'deploy') {

  await (operation === 'deploy' ? page.getByRole('button', { name: 'Deploy Version', exact: true }) : page.getByTestId('rollback-action')).click()
  await page.getByRole('button', { name: operation === 'deploy' ? 'Confirm Deploy' : 'Confirm Rollback', exact: true }).click()
}

test('normal UI hides simulation language and fails closed with actionable setup guidance', async ({ page }) => {
  const requests = await setup(page, { config: { ...executionConfig, dryRun: true, executionEnabled: false } })

  await expect(page.getByRole('button', { name: 'Deploy Version', exact: true })).toBeEnabled()
  await page.getByTestId('rollback-action').click()
  await expect(page.locator('.workflow-error')).toContainText('Real execution disabled')
  expect(await page.locator('body').innerText()).not.toMatch(/dry[ -]run/i)
  expect(requests.count()).toBe(0)
})
test('the primary action opens the change review; only confirmation executes', async ({ page }) => {
  const calls = await setup(page)
  await page.getByTestId('rollback-action').click()
  await expect(page.locator('.deploy-confirm-details')).toContainText(current)
  await expect(page.locator('.deploy-confirm-details')).toContainText(target)
  expect(calls.count()).toBe(0)
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect(calls.count()).toBe(0)
})
test('a simulation response never becomes deployment success', async ({ page }) => {
  const calls = await setup(page, { post: route => route.fulfill({ json: { state: 'dry-run', dryRun: true, success: true, message: 'Dry run successful' } }) })
  await confirm(page)
  await expect(page.getByRole('status')).toHaveText('Deployment failed')
  await expect(page.getByRole('alert')).toContainText('No deployment was performed')
  expect(await page.locator('body').innerText()).not.toMatch(/dry[ -]run/i)
  expect(calls.count()).toBe(1)
})
test('missing rollout health proof never becomes success', async ({ page }) => {
  await setup(page, { post: route => route.fulfill({ json: { ...healthy, progress: { healthy: false } } }) })
  await confirm(page)
  await expect(page.getByRole('status')).toHaveText('Deployment failed')
  await expect(page.getByRole('alert')).toContainText('did not confirm deployment health')
})
test('authentication failure clears credentials and allows recovery without weakening checks', async ({ page }) => {
  const calls = await setup(page, { post: (route, count) => count === 1 ? route.fulfill({ status: 401, json: { message: 'Invalid deployment token' } }) : route.fulfill({ json: healthy }) })
  await confirm(page)
  await expect(page.locator('input[type=password]')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Deploy Version', exact: true })).toBeEnabled()
  await refreshSessionFixture(page, true)
  await page.getByRole('button', { name: 'Deploy Version', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm Deploy', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('Deployment healthy')
  expect(calls.count()).toBe(2)
})
test('progress separates commit, synchronization, rollout and final observed health', async ({ page }) => {
  let polls = 0
  const observations = [
    { stage: 'gitops-commit', progress: { requestAccepted: true, commitCreated: true } },
    { stage: 'argocd-sync', progress: { requestAccepted: true, commitCreated: true } },
    { stage: 'kubernetes-rollout', progress: { requestAccepted: true, commitCreated: true, argoSynced: true } },
    { stage: 'health-verification', progress: { requestAccepted: true, commitCreated: true, argoSynced: true, rolloutReady: true } }
  ]
  await setup(page, { post: route => route.fulfill({ json: { ...healthy, state: 'requested', success: false, stage: 'request-accepted', progress: { requestAccepted: true } } }), status: route => {
    const next = observations[polls++]
    return route.fulfill({ json: next ? { ...healthy, state: 'in-progress', success: false, ...next } : healthy })
  } })
  await confirm(page)
  await expect(page.getByRole('status')).toHaveText('Deployment requested')
  await expect(page.locator('.commit-reference')).toContainText('c'.repeat(40))
  await expect(page.locator('.step-active')).toContainText('ArgoCD sync', { timeout: 10000 })
  await expect(page.locator('.step-active')).toContainText('Kubernetes rollout')
  await expect(page.locator('.step-active')).toContainText('Health verification')
  await expect(page.getByRole('status')).toHaveText('Deployment healthy')
  await expect(page.locator('.step-complete')).toHaveCount(5)
})
test('history rollback action selects the revision and still requires verification, preview and confirmation', async ({ page }) => {
  const calls = await setup(page, { post: route => route.fulfill({ json: { ...healthy, operation: 'rollback' } }) })
  await page.getByRole('button', { name: 'Select revision 4 for rollback', exact: true }).click()
  await expect(page.getByTestId('rollback-action')).toHaveText('Rollback')
  await page.getByRole('button', { name: 'Verify Image Availability', exact: true }).click()
  await confirm(page, 'rollback')
  await expect(page.getByRole('status')).toHaveText('Rollback healthy')
  expect(calls.count()).toBe(1)
})
test('duplicate confirmation cannot create two submissions', async ({ page }) => {
  const calls = await setup(page)

  await page.getByRole('button', { name: 'Deploy Version', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm Deploy', exact: true }).evaluate(element => { element.click(); element.click() })
  await expect(page.getByRole('status')).toHaveText('Deployment healthy')
  expect(calls.count()).toBe(1)
})
test('sessions survive navigation without credentials in browser storage', async ({ page }) => {
  await setup(page)
  await page.getByRole('link', { name: 'Overview', exact: true }).click()
  await page.getByRole('link', { name: 'Deployments', exact: true }).click()
  await expect(page.locator('input[type=password]')).toHaveCount(0)
  expect(await page.evaluate(() => Object.keys(localStorage).length + Object.keys(sessionStorage).length)).toBe(0)
})

test('mobile layout retains readable navigation and avoids double sidebar spacing or overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await setup(page)
  const bounds = await page.locator('.workspace-heading').boundingBox()
  expect(bounds.x).toBeGreaterThanOrEqual(92)
  expect(bounds.x).toBeLessThan(120)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
})
