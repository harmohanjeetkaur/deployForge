import { refreshSessionFixture } from './ui-fixtures.js'
import { executionConfig , handleSession } from './ui-fixtures.js'
import { test, expect } from '@playwright/test'

const repo = 'ghcr.io/harmohanjeetkaur/deployforge'
const current = '210426be6d6da6c2e16f234db410f83a0c98bbd2'
const previous = '5b6d2c0589ab9e4a6dedbde072a95ccf124921aa'
const past = { revision: '4', deploymentRevision: '5', containerImage: `${repo}:${previous}`, isCurrent: false, rollbackEligible: true }

async function setup(page, { history = [past, { ...past, revision: '5', containerImage: `${repo}:${current}`, isCurrent: true, rollbackEligible: false }], post, status } = {}) {
  await page.route('**/api/**', async route => {
    if (handleSession(route)) return;
    if (new URL(route.request().url()).pathname === '/api/releases') return route.fulfill({ json: { releases: [] } })
    if (new URL(route.request().url()).pathname === '/api/repositories') return route.fulfill({ json: { repositories: [] } })
    const request = route.request()
    const path = new URL(request.url()).pathname
    let json
    if (path === '/api/deploy/config') json = executionConfig
    else if (path === '/api/kubernetes/status') json = { currentImage: `${repo}:${current}`, desiredReplicas: 3, readyReplicas: 3, pods: [] }
    else if (path === '/api/kubernetes/history') json = history
    else if (path.startsWith('/api/images/verify/')) json = { valid: true, exists: true, platformsSupported: true }
    else if (path === '/api/rollback') {
      expect(request.method()).toBe('POST')
      expect(route.request().headers()['x-csrf-token']).toBe('test-csrf')
      expect(request.postDataJSON()).toEqual({ tag: previous, execution: 'real', environment: 'docker-desktop' })
      return post(route)
    } else if (path.startsWith('/api/deploy/status/')) return status(route)
    else throw new Error(`Unexpected API request ${path}`)
    await route.fulfill({ json })
  })
  await page.goto('/')
  await page.getByRole('link', { name: 'Deployments', exact: true }).click()
  await page.getByRole('button', { name: 'Roll back a version', exact: true }).click()
  await page.locator('#version-select').selectOption('k8s-4')

}
async function confirm(page) {
  await page.getByRole('button', { name: 'Verify Image Availability', exact: true }).click()
  await expect(page.getByText('✓ Image verified in GHCR', { exact: true })).toBeVisible()
  await page.getByTestId('rollback-action').click()
  await expect(page.getByRole('heading', { name: 'Confirm Rollback', exact: true })).toBeVisible()
  await expect(page.locator('.deploy-confirm-details')).toContainText(`${repo}:${current}`)
  await expect(page.locator('.deploy-confirm-details')).toContainText(`${repo}:${previous}`)
  await expect(page.locator('.deploy-confirm-warning')).toContainText('ArgoCD will reconcile')
  await page.getByRole('button', { name: 'Confirm Rollback', exact: true }).click()
}

test('rollback execution uses authenticated API, shows both images and resets on selection', async ({ page }) => {
  let requests = 0
  await setup(page, { post: route => { requests++; return route.fulfill({ json: { operation: 'rollback', state: 'succeeded', progress: { requestAccepted: true, commitCreated: true, argoSynced: true, rolloutReady: true, healthy: true }, stage: 'healthy', pushed: true, commit: 'c'.repeat(40), dryRun: false, success: true, currentTag: current, tag: previous, message: 'Rollback dry run' } }) } })
  await expect(page.getByTestId('rollback-action')).toBeEnabled()
  await confirm(page)
  await expect(page.getByRole('status')).toHaveText('Rollback healthy')
  await expect(page.getByTestId('rollback-action')).toBeEnabled()
  expect(requests).toBe(1)
  await page.locator('#version-select').selectOption('')

  await expect(page.getByRole('status')).toHaveText('Ready')
  await expect(page.locator('.verification-result')).toHaveCount(0)
})

test('simulated rollback job displays requested, in progress, then succeeded', async ({ page }) => {
  let polls = 0
  await setup(page, {
    post: route => route.fulfill({ json: { operation: 'rollback', id: 'rollback-job', tag: previous, dryRun: false, state: 'requested', message: 'Rollback requested' } }),
    status: route => {
      polls++
      return route.fulfill({ json: { operation: 'rollback', id: 'rollback-job', tag: previous, dryRun: false,
        state: polls === 1 ? 'in-progress' : 'succeeded', progress: { requestAccepted: true, commitCreated: true, argoSynced: true, rolloutReady: polls > 1, healthy: polls > 1 }, stage: polls === 1 ? 'kubernetes-rollout' : 'healthy', success: true, message: polls === 1 ? 'Waiting for convergence' : 'Rollback succeeded' } })
    }
  })
  await confirm(page)
  await expect(page.getByRole('status')).toHaveText('Rollback requested')
  await expect(page.getByRole('status')).toHaveText('Rollback in progress')
  await expect(page.getByRole('status')).toHaveText('Rollback healthy')
  await expect(page.getByTestId('rollback-action')).toBeEnabled()
  expect(polls).toBe(2)
})

for (const failure of [
  { code: 401, message: 'Invalid deployment token' },
  { code: 409, message: 'A deployment is already in progress' },
  { code: 400, message: 'Git push failed; commit preserved locally' },
  { code: 400, message: 'Target is not a previous retained deployment revision' }
]) {
  test(`rollback API error ${failure.code}: ${failure.message}`, async ({ page }) => {
    let requests = 0
    await setup(page, { post: route => { requests++; return route.fulfill({ status: failure.code, json: { state: 'failed', message: failure.message } }) } })
    await confirm(page)
    await expect(page.getByRole('status')).toHaveText(failure.code === 401 ? 'Authorization required' : 'Rollback failed')
    await expect(page.locator('.preview-error')).toContainText(failure.message)
    if (failure.code === 401) {
  await expect(page.locator('input[type=password]')).toHaveCount(0)
      await expect(page.getByTestId('rollback-action')).toBeEnabled()
      await refreshSessionFixture(page, true)
    }
    await expect(page.getByTestId('rollback-action')).toBeEnabled()
    expect(requests).toBe(1)
  })
}

test('rollback convergence timeout shows failure, clears busy state, and never retries', async ({ page }) => {
  let requests = 0, polls = 0
  await setup(page, {
    post: route => { requests++; return route.fulfill({ json: { operation: 'rollback', id: 'timeout-job', tag: previous, dryRun: false, state: 'requested' } }) },
    status: route => { polls++; return route.fulfill({ json: { operation: 'rollback', id: 'timeout-job', tag: previous, dryRun: false, state: 'failed', success: false, message: 'Timed out waiting for target image and ArgoCD Synced/Healthy; no automatic recovery performed' } }) }
  })
  await confirm(page)
  await expect(page.getByRole('status')).toHaveText('Rollback failed')
  await expect(page.locator('.preview-error')).toContainText('Timed out')
  await expect(page.getByTestId('rollback-action')).toBeEnabled()
  expect(requests).toBe(1)
  expect(polls).toBe(1)
})

test('rollback remains tracked when a pending version change is rejected', async ({ page }) => {
  let received, release, requests = 0
  const started = new Promise(resolve => { received = resolve })
  const delayed = new Promise(resolve => { release = resolve })
  await setup(page, { post: async route => {
    requests++; received(); await delayed
    await route.fulfill({ json: { operation: 'rollback', state: 'succeeded', progress: { requestAccepted: true, commitCreated: true, argoSynced: true, rolloutReady: true, healthy: true }, stage: 'healthy', pushed: true, commit: 'c'.repeat(40), dryRun: false, success: true, message: 'Stale rollback result' } }).catch(() => {})
  } })
  await confirm(page)
  await started
  await expect(page.getByTestId('rollback-action')).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Rolling back...', exact: true })).toBeEnabled()
  await page.locator('#version-select').selectOption('')

  await expect(page.locator('#version-select')).toHaveValue('k8s-4')
  await expect(page.locator('.workflow-error')).toContainText('already running')
  release()
  await expect(page.getByRole('status')).toHaveText('Rollback healthy')
  await expect(page.getByText('Stale rollback result', { exact: true })).toHaveCount(0)
  expect(requests).toBe(1)
})

for (const version of [
  { ...past, rollbackEligible: false },
  { ...past, containerImage: `${repo}:${current}`, isCurrent: true, rollbackEligible: false },
  { ...past, containerImage: `${repo}:latest`, rollbackEligible: false },
  { ...past, containerImage: `other/repo:${previous}`, rollbackEligible: false }
]) {
  test(`rollback disallows invalid/current/unretained target ${version.containerImage} ${version.isCurrent}`, async ({ page }) => {
    await setup(page, { history: [version], post: () => { throw new Error('must not submit rollback') } })
    await page.getByRole('button', { name: 'Verify Image Availability', exact: true }).click()
    await expect(page.getByTestId('rollback-action')).toBeEnabled()
    await page.getByTestId('rollback-action').click()
    await expect(page.locator('.workflow-error')).toBeVisible()
    await expect(page.locator('.modal-overlay')).toHaveCount(0)
  })
}

test('rollback confirmation cancel never submits an operation', async ({ page }) => {
  await setup(page, { post: () => { throw new Error('must not submit rollback') } })
  await page.getByRole('button', { name: 'Verify Image Availability', exact: true }).click()
  await page.getByTestId('rollback-action').click()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.locator('.modal-overlay')).toHaveCount(0)
  await expect(page.getByRole('status')).toHaveText('Ready')
})
