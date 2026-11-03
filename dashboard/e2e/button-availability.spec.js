import { executionConfig, previewIfAvailable } from './ui-fixtures.js'
import { test, expect } from '@playwright/test'

const repo = 'ghcr.io/harmohanjeetkaur/deployforge'
const current = '210426be6d6da6c2e16f234db410f83a0c98bbd2'
const previous = '5b6d2c0589ab9e4a6dedbde072a95ccf124921aa'
const legacy = { revision: '4', containerImage: `${repo}:${previous}`, isCurrent: false }
const eligible = { ...legacy, deploymentRevision: '5', rollbackEligible: true }
const mockToken = 'button-test-only-token'

async function setup(page, { history = [eligible], secondHistory, statusUnavailable = false } = {}) {
  let useSecondHistory = false, posts = 0
  await page.route('**/api/**', async route => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    let json
    if (path === '/api/deploy/config') json = executionConfig
    else if (path === '/api/kubernetes/status') {
      if (statusUnavailable) return route.fulfill({ status: 500, json: { message: 'Unavailable' } })
      json = { currentImage: `${repo}:${current}`, desiredReplicas: 3, readyReplicas: 3, pods: [] }
    } else if (path === '/api/kubernetes/history') {
      json = useSecondHistory && secondHistory ? secondHistory : history
    } else if (path.startsWith('/api/images/verify/')) json = { valid: true, exists: true, platformsSupported: true }
    else if (path === '/api/rollback') {
      posts++
      expect(request.headers().authorization).toBe(`Bearer ${mockToken}`)
      expect(request.postDataJSON()).toEqual({ tag: previous, execution: 'real', environment: 'docker-desktop' })
      json = { operation: 'rollback', state: 'succeeded', progress: { requestAccepted: true, commitCreated: true, argoSynced: true, rolloutReady: true, healthy: true }, stage: 'healthy', pushed: true, commit: 'c'.repeat(40), dryRun: false, success: true, currentTag: current, tag: previous, message: 'Rollback dry run complete' }
    } else throw new Error(`Unexpected request ${path}`)
    await route.fulfill({ json })
  })
  await page.goto('/')
  await page.getByRole('link', { name: 'Deployments', exact: true }).click()
  await page.locator('#version-select').selectOption('k8s-4')
  await previewIfAvailable(page)
  return { requests: () => posts, useFreshHistory: () => { useSecondHistory = true } }
}
async function verify(page) {
  await page.getByRole('button', { name: 'Verify Image Availability', exact: true }).click()
  await expect(page.getByText('✓ Image verified in GHCR', { exact: true })).toBeVisible()
}

test('legacy backend metadata is Unknown, never No; token and eligibility blockers are independent', async ({ page }) => {
  const calls = await setup(page, { history: [legacy] })
  await verify(page)
  await expect(page.locator('.version-info')).toContainText('Rollback eligible: Unknown — backend eligibility metadata unavailable')
  await expect(page.locator('#rollback-requirements')).toContainText('Load the latest backend code, then refresh versions.')
  await expect(page.locator('#gitops-requirements')).toContainText('Enter the deployment token to authorize this request.')
  await expect(page.getByRole('button', { name: 'Deploy Version', exact: true })).toBeDisabled()
  await expect(page.getByTestId('rollback-action')).toBeDisabled()
  await page.locator('input[type=password]').fill(mockToken)
  await expect(page.getByRole('button', { name: 'Deploy Version', exact: true })).toBeEnabled()
  await expect(page.getByTestId('rollback-action')).toBeDisabled()
  expect(calls.requests()).toBe(0)
})

test('valid previous revision enables authenticated rollback; empty/whitespace tokens never enable it', async ({ page }) => {
  const calls = await setup(page)
  await verify(page)
  await expect(page.locator('.version-info')).toContainText('Rollback eligible: Yes')
  for (const token of ['', '   ']) {
    await page.locator('input[type=password]').fill(token)
    await expect(page.getByRole('button', { name: 'Deploy Version', exact: true })).toBeDisabled()
    await expect(page.getByTestId('rollback-action')).toBeDisabled()
  }
  await page.locator('input[type=password]').fill(` ${mockToken} `)
  await expect(page.getByRole('heading', { name: 'Deploy a Version', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Deploy Version', exact: true })).toBeEnabled()
  await page.getByTestId('rollback-action').click()
  await expect(page.locator('.deploy-confirm-details')).toContainText(current)
  await expect(page.locator('.deploy-confirm-details')).toContainText(previous)
  await page.getByRole('button', { name: 'Confirm Rollback', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('Rollback healthy')
  expect(calls.requests()).toBe(1)
})

test('refresh replaces stale selected revision metadata without a frontend eligibility override', async ({ page }) => {
  const calls = await setup(page, { history: [legacy], secondHistory: [eligible] })
  await page.locator('input[type=password]').fill(mockToken)
  await verify(page)
  await expect(page.getByTestId('rollback-action')).toBeDisabled()
  calls.useFreshHistory()
  await page.getByRole('button', { name: 'Refresh Versions', exact: true }).click()
  await expect(page.locator('#version-select')).toHaveValue('k8s-4')
  await expect(page.locator('.version-info')).toContainText('Rollback eligible: Yes')
  await expect(page.getByTestId('rollback-action')).toBeEnabled()
  expect(calls.requests()).toBe(0)
})

for (const value of [false, 'true']) {
  test(`explicit rejection or malformed eligibility remains blocked: ${value}`, async ({ page }) => {
    const calls = await setup(page, { history: [{ ...eligible, rollbackEligible: value }] })
    await page.locator('input[type=password]').fill(mockToken)
    await verify(page)
    await expect(page.locator('.version-info')).toContainText(value === false ? 'Rollback eligible: No' : 'Rollback eligible: Unknown')
    await expect(page.getByTestId('rollback-action')).toBeDisabled()
    expect(calls.requests()).toBe(0)
  })
}

test('unavailable Kubernetes status keeps both operations blocked despite verification', async ({ page }) => {
  await setup(page, { statusUnavailable: true })
  await page.locator('input[type=password]').fill(mockToken)
  await verify(page)
  await expect(page.locator('#gitops-requirements')).toContainText('Current Kubernetes status is unavailable.')
  await expect(page.getByRole('button', { name: 'Deploy Version', exact: true })).toBeDisabled()
  await expect(page.getByTestId('rollback-action')).toBeDisabled()
})

test('confirmation stays cancellable if the token is cleared', async ({ page }) => {
  const calls = await setup(page)
  await page.locator('input[type=password]').fill(mockToken)
  await verify(page)
  await page.getByTestId('rollback-action').click()
  await page.locator('input[type=password]').fill('')
  await expect(page.getByRole('button', { name: 'Confirm Rollback', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.locator('.modal-overlay')).toHaveCount(0)
  expect(calls.requests()).toBe(0)
})
