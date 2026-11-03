import { executionConfig, previewIfAvailable, openImageEntry } from './ui-fixtures.js'
import { test, expect } from '@playwright/test'
const repo = 'ghcr.io/harmohanjeetkaur/deployforge'
const current = '210426be6d6da6c2e16f234db410f83a0c98bbd2'
const previous = '5b6d2c0589ab9e4a6dedbde072a95ccf124921aa'

async function setup(page, { verificationError, deployError } = {}) {
  let posts = 0
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname
    let json
    if (path === '/api/deploy/config') json = executionConfig
    else if (path === '/api/kubernetes/status') json = { currentImage: `${repo}:${current}`, desiredReplicas: 3, readyReplicas: 3, pods: [] }
    else if (path === '/api/kubernetes/history') json = [{ revision: '5', deploymentRevision: '5', containerImage: `${repo}:${current}`, isCurrent: true, rollbackEligible: false }, { revision: '4', deploymentRevision: '5', containerImage: `${repo}:${previous}`, isCurrent: false, rollbackEligible: true }]
    else if (path.startsWith('/api/images/verify/')) json = verificationError ? { valid: true, exists: false, platformsSupported: false, error: verificationError } : { valid: true, exists: true, platformsSupported: true }
    else if (path === '/api/deploy') {
      posts++
      expect(route.request().headers().authorization).toBe('Bearer test-only-token')
      if (deployError) return route.fulfill({ status: 400, json: { message: deployError, state: 'failed' } })
      json = { operation: 'deploy', state: 'succeeded', progress: { requestAccepted: true, commitCreated: true, argoSynced: true, rolloutReady: true, healthy: true }, stage: 'healthy', pushed: true, commit: 'c'.repeat(40), dryRun: false, success: true, tag: previous, currentTag: current, message: 'Deployment dry run complete' }
    } else throw new Error(`Unexpected API request ${path}`)
    return route.fulfill({ json })
  })
  await page.goto('/')
  await page.getByRole('link', { name: 'Deployments', exact: true }).click()
  return { posts: () => posts }
}

test('Deploy New Version selects a different history-derived image and preview works before verification', async ({ page }) => {
  const calls = await setup(page)
  await page.getByRole('button', { name: 'Refresh Versions', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Refresh Versions', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Deploy New Version', exact: true }).click()
  await expect(page.getByText('Deployment mode', { exact: true })).toBeVisible()
  await expect(page.locator('#version-select')).toHaveValue(`ghcr-history-${previous}`)
  await expect(page.getByRole('button', { name: 'Deploy Version', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Preview Version Change', exact: true }).click()
  await expect(page.locator('.preview-side.current')).toContainText(current)
  await expect(page.locator('.preview-side.target')).toContainText(previous)
  await expect(page.locator('.unverified-label')).toHaveText('Image availability has not been verified')
  expect(calls.posts()).toBe(0)
})

test('selected image verification, authenticated confirmation cancellation and execution work', async ({ page }) => {
  const calls = await setup(page)
  await page.locator('#version-select').selectOption(`ghcr-history-${previous}`)
  await previewIfAvailable(page)
  await page.getByRole('button', { name: 'Verify Image Availability', exact: true }).click()
  await expect(page.getByText('✓ Image verified in GHCR', { exact: true })).toBeVisible()
  await page.locator('input[type=password]').fill('test-only-token')
  await page.getByRole('button', { name: 'Preview Version Change', exact: true }).click()
  await expect(page.locator('.unverified-label')).toHaveText('Image verified in GHCR for both required platforms')
  await page.getByRole('button', { name: 'Deploy Version', exact: true }).click()
  await expect(page.locator('.deploy-confirm-details')).toContainText(current)
  await expect(page.locator('.deploy-confirm-details')).toContainText(previous)
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect(calls.posts()).toBe(0)
  await page.getByRole('button', { name: 'Deploy Version', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm Deploy', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('Deployment healthy')
  expect(calls.posts()).toBe(1)
})

test('SHA input rejects mutable tags and resets verification for a new candidate', async ({ page }) => {
  await setup(page)
  await openImageEntry(page)
  await page.locator('#image-sha-input').fill('latest')
  await page.getByRole('button', { name: 'Use Image Tag', exact: true }).click()
  await previewIfAvailable(page)
  await expect(page.locator('.image-candidate-input .error-text')).toContainText('Mutable tag')
  await openImageEntry(page)
  await page.locator('#image-sha-input').fill(previous)
  await page.getByRole('button', { name: 'Use Image Tag', exact: true }).click()
  await previewIfAvailable(page)
  await expect(page.locator('#version-select')).toHaveValue(`ghcr-history-${previous}`)
  await page.getByRole('button', { name: 'Verify Image Availability', exact: true }).click()
  await openImageEntry(page)
  await page.locator('#image-sha-input').fill('a'.repeat(40))
  await page.getByRole('button', { name: 'Use Image Tag', exact: true }).click()
  await previewIfAvailable(page)
  await expect(page.locator('#version-select')).toHaveValue(`ghcr-input-${'a'.repeat(40)}`)
  await expect(page.getByRole('button', { name: 'Deploy Version', exact: true })).toBeDisabled()
})

test('registry failure details remain visible and prevent deployment', async ({ page }) => {
  const calls = await setup(page, { verificationError: 'Rate limited by registry' })
  await page.locator('#version-select').selectOption(`ghcr-history-${previous}`)
  await previewIfAvailable(page)
  await page.locator('input[type=password]').fill('test-only-token')
  await page.getByRole('button', { name: 'Verify Image Availability', exact: true }).click()
  await expect(page.getByText('✗ Rate limited by registry', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Deploy Version', exact: true })).toBeDisabled()
  expect(calls.posts()).toBe(0)
})

test('a current image cannot be previewed or deployed', async ({ page }) => {
  await setup(page)
  await page.locator('#version-select').selectOption('ghcr-ghcr-210426be')
  await previewIfAvailable(page)
  await expect(page.getByRole('button', { name: 'Preview Version Change', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Deploy Version', exact: true })).toBeDisabled()
  await expect(page.locator('#gitops-requirements')).toContainText('This image is already deployed')
})

test('Git validation failure is explicit and restores the action button', async ({ page }) => {
  const calls = await setup(page, { deployError: 'Tracked or staged changes exist. Preserve and resolve them before deploying.' })
  await page.locator('#version-select').selectOption(`ghcr-history-${previous}`)
  await previewIfAvailable(page)
  await page.locator('input[type=password]').fill('test-only-token')
  await page.getByRole('button', { name: 'Verify Image Availability', exact: true }).click()
  await page.getByRole('button', { name: 'Deploy Version', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm Deploy', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('Deployment failed')
  await expect(page.locator('.preview-error')).toContainText('Tracked or staged changes exist')
  await expect(page.getByRole('button', { name: 'Deploy Version', exact: true })).toBeEnabled()
  expect(calls.posts()).toBe(1)
})
