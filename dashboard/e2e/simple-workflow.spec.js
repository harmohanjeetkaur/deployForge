import { test, expect } from '@playwright/test'
import { executionConfig, handleSession, setSession, refreshSessionFixture } from './ui-fixtures.js'
const repo = 'ghcr.io/harmohanjeetkaur/deployforge'
const current = 'a'.repeat(40), target = 'b'.repeat(40)
const failures = [
  { name: 'unverified image', verify: false, message: 'Verify image availability' },
  { name: 'missing session', session: false, message: 'local browser session' },
  { name: 'current image', current: true, message: 'already deployed' },
  { name: 'unsupported platform', platform: false, message: 'Verify image availability' },
  { name: 'ineligible rollback', rollback: true, eligible: false, message: 'not eligible for rollback' },
  { name: 'execution unavailable', enabled: false, message: 'Real execution disabled' }
]
for (const scenario of failures) test(`clickable action explains ${scenario.name} without submitting`, async ({ page }) => {
  let posts = 0
  setSession(page, scenario.session !== false)
  await page.route('**/api/**', route => {
    if (handleSession(route)) return
    const path = new URL(route.request().url()).pathname
    if (route.request().method() !== 'GET') { posts++; return route.abort() }
    let json
    if (path.endsWith('/config')) json = { ...executionConfig, executionEnabled: scenario.enabled !== false, dryRun: scenario.enabled === false }
    else if (path.endsWith('/status')) json = { currentImage: `${repo}:${current}`, desiredReplicas: 3, readyReplicas: 3, pods: [] }
    else if (path.endsWith('/history')) json = [{ revision: '6', deploymentRevision: '7', containerImage: `${repo}:${scenario.current ? current : target}`, isCurrent: Boolean(scenario.current), rollbackEligible: scenario.eligible !== false }]
    else json = { valid: true, exists: true, platformsSupported: scenario.platform !== false, platforms: scenario.platform === false ? ['linux/amd64'] : ['linux/amd64','linux/arm64'] }
    return route.fulfill({ json })
  })
  await page.goto('/')
  await page.getByRole('link', { name: 'Deployments', exact: true }).click()
  await expect(page.getByTestId('execution-status')).toHaveAttribute('data-state', scenario.enabled === false ? 'disabled' : 'enabled')
  await page.getByRole('button', { name: scenario.rollback ? 'Roll back a version' : 'Deploy a version', exact: true }).click()
  if (scenario.rollback) await page.locator('#version-select').selectOption('k8s-6')
  else await page.locator('#version-select').selectOption(`ghcr-history-${scenario.current ? current : target}`)
  if (scenario.verify !== false) {
    await page.getByRole('button', { name: 'Verify Image Availability', exact: true }).click()
    await expect(page.locator('.verification-result')).toBeVisible()
  }
  await expect(page.locator('button:disabled')).toHaveCount(0)
  await page.getByTestId('rollback-action').click()
  await expect(page.locator('.workflow-error')).toContainText(scenario.message)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(posts).toBe(0)
  if (scenario.session === false) {
    await refreshSessionFixture(page, true)
    await expect(page.locator('.workflow-error')).toHaveCount(0)
    expect(posts).toBe(0)
  }
})

test('mobile workflow has only operation, selection, verification, and review-on-action', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.route('**/api/**', route => {
    if (handleSession(route)) return
    const path = new URL(route.request().url()).pathname
    if (route.request().method() !== 'GET') throw new Error('No operation may be submitted')
    return route.fulfill({ json: path.endsWith('/config') ? executionConfig : path.endsWith('/history') ? [{ revision: '6', deploymentRevision: '7', rollbackEligible: true, isCurrent: false, containerImage: `${repo}:${target}` }] : path.includes('/verify/') ? { valid: true, exists: true, platformsSupported: true } : { currentImage: `${repo}:${current}`, readyReplicas: 3, desiredReplicas: 3, pods: [] } })
  })
  await page.goto('/')
  await page.getByRole('link', { name: 'Deployments', exact: true }).click()
  await page.getByRole('button', { name: 'Roll back a version', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Roll back a version', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Verify Image Availability', exact: true }).click()
  await expect(page.getByText('✓ Image verified in GHCR', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Rollback', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText(`${repo}:${current}`)
  await expect(page.getByRole('dialog')).toContainText(`${repo}:${target}`)
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('input[type=password]')).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
})
