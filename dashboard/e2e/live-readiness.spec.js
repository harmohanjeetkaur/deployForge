import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'

test('live local session: token-free UI, verified image, and both confirmations cancel without executing', async ({ page }) => {
  test.skip(process.env.DEPLOYFORGE_READ_ONLY_UI !== '1', 'Opt-in session and read-only release verification')
  let prohibited = 0
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname
    if (path.startsWith('/api/session')) return route.continue()
    if (route.request().method() !== 'GET') { prohibited++; return route.abort() }
    return route.continue()
  })
  await page.goto('/')
  await page.getByRole('link', { name: 'Settings', exact: true }).click()
  const code = page.locator('[aria-label="Local browser connection"] > code')
  await expect(code).toHaveText(/^[a-f0-9]{8}$/)
  const approvalId = await code.textContent()
  try { execFileSync(process.execPath, ['server/authorize-local.js', approvalId], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000 }) } catch { throw new Error('Local session pairing failed; credential values withheld') }
  await expect(page.locator('.environment-chip')).toContainText('Local session connected')
  const cookies = await page.context().cookies()
  expect(cookies.some(c => c.name === 'deployforge_session' && c.httpOnly && c.secure && c.sameSite === 'Strict')).toBe(true)
  expect(await page.evaluate(() => document.cookie.includes('deployforge_session'))).toBe(false)
  const live = await (await page.request.get('/api/kubernetes/status')).json()
  const history = await (await page.request.get('/api/kubernetes/history')).json()
  const previous = history.find(entry => entry.rollbackEligible === true && entry.containerImage !== live.currentImage)
  if (!previous) throw new Error('No previous eligible image is available')
  const target = previous.containerImage.split(':').at(-1)
  await page.getByRole('link', { name: 'Deployments', exact: true }).click()
  await expect(page.locator('input[type=password]')).toHaveCount(0)
  await expect(page.getByText('Authorize Deployment', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Clear token', exact: true })).toHaveCount(0)
  await page.locator('#version-select').selectOption(target === '210426be6d6da6c2e16f234db410f83a0c98bbd2' ? 'ghcr-ghcr-210426be' : `ghcr-history-${target}`)
  for (const operation of ['deploy', 'rollback']) {
    if (operation === 'rollback') {
      await page.getByRole('button', { name: 'Roll back a version', exact: true }).click()
      await page.locator('#version-select').selectOption(`k8s-${previous.revision}`)
    }
    await page.getByRole('button', { name: 'Verify Image Availability', exact: true }).click()
    await expect(page.getByText('✓ Image verified in GHCR', { exact: true })).toBeVisible()

    await expect(page.getByTestId('rollback-action')).toBeEnabled()
    await page.getByTestId('rollback-action').click()
    await expect(page.getByRole('heading', { name: operation === 'deploy' ? 'Confirm Deployment' : 'Confirm Rollback', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: '/private/tmp/deployforge-no-token-mobile.png', fullPage: true })
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.screenshot({ path: '/private/tmp/deployforge-no-token-desktop.png', fullPage: true })
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0)
  expect(prohibited).toBe(0)
})
