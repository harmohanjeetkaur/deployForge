import { handleSession } from './ui-fixtures.js'
import { test, expect } from '@playwright/test'
import { executionConfig } from './ui-fixtures.js'
const status = { currentImage: `ghcr.io/harmohanjeetkaur/deployforge:${'a'.repeat(40)}`, pods: [], desiredReplicas: 3, readyReplicas: 3 }
async function setup(page) {
  let config = { ...executionConfig, executionEnabled: false, dryRun: true }
  let unavailable = false
  await page.route('**/api/**', route => {
    if (handleSession(route)) return;
    if (new URL(route.request().url()).pathname === '/api/releases') return route.fulfill({ json: { releases: [] } })
    if (new URL(route.request().url()).pathname === '/api/repositories') return route.fulfill({ json: { repositories: [] } })
    expect(route.request().method()).toBe('GET')
    const path = new URL(route.request().url()).pathname
    if (path === '/api/deploy/config') return route.fulfill({ status: unavailable ? 503 : 200, json: unavailable ? {} : config })
    if (path === '/api/kubernetes/history') return route.fulfill({ json: [] })
    if (path === '/api/kubernetes/status') return route.fulfill({ json: status })
    throw new Error(`Unexpected request ${path}`)
  })
  await page.goto('/')
  return { configure: value => { config = value }, unavailable: value => { unavailable = value } }
}
const badge = page => page.getByTestId('execution-status')
for (const width of [1280, 390]) {
  test(`all three pages agree on disabled/enabled configuration at width ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    const backend = await setup(page)
    for (const [config, label, key] of [
      [{ ...executionConfig, executionEnabled: false, dryRun: true }, 'Real execution disabled', 'disabled'],
      [executionConfig, 'Execution enabled', 'enabled']
    ]) {
      backend.configure(config)
      for (const name of ['Overview', 'Deployments', 'Settings']) {
        await page.getByRole('link', { name, exact: true }).click()
        if (name === 'Overview') {
          await expect(badge(page)).toHaveCount(0)
          await expect(page.getByText(label, { exact: true })).toBeVisible()
          continue
        }
        await expect(badge(page)).toHaveAttribute('data-state', key)
        await expect(badge(page).locator('strong')).toHaveText(label)
        await expect(badge(page)).toContainText('Server authentication: Configured')
        if (key === 'disabled') await expect(badge(page)).toContainText('DEPLOYFORGE_ENABLE_DEPLOY=true')
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
      }
    }
    await page.reload()
    await expect(badge(page)).toHaveCount(0)
    await expect(page.getByText('Execution enabled', { exact: true })).toBeVisible()
  })
}
test('backend restart simulation fails closed and recovers via poll, focus, and explicit refresh', async ({ page }) => {
  await page.clock.install()
  const backend = await setup(page)
  await page.getByRole('link', { name: 'Settings', exact: true }).click()
  await expect(badge(page)).toHaveAttribute('data-state', 'disabled')
  backend.unavailable(true)
  await page.clock.runFor(10000)
  await expect(badge(page)).toHaveAttribute('data-state', 'unavailable')
  await expect(badge(page)).toContainText('HTTP 503')
  backend.unavailable(false)
  backend.configure(executionConfig)
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(badge(page)).toHaveAttribute('data-state', 'enabled')
  backend.configure({ ...executionConfig, executionEnabled: false, dryRun: true })
  await page.getByRole('button', { name: 'Refresh configuration', exact: true }).click()
  await expect(badge(page)).toHaveAttribute('data-state', 'disabled')
})
test('contradictory flags and incompatible capabilities cannot advertise real execution', async ({ page }) => {
  const backend = await setup(page)
  await page.getByRole('link', { name: 'Settings', exact: true }).click()
  backend.configure({ ...executionConfig, dryRun: true })
  await page.getByRole('button', { name: 'Refresh configuration', exact: true }).click()
  await expect(badge(page)).toHaveAttribute('data-state', 'unavailable')
  await expect(badge(page)).toContainText('Inconsistent backend execution flags')
  backend.configure({ ...executionConfig, capabilities: {} })
  await page.getByRole('link', { name: 'Deployments', exact: true }).click()
  await expect(badge(page)).toHaveAttribute('data-state', 'unsupported')
  await expect(page.getByTestId('rollback-action')).toBeEnabled()
})
test('superseded configuration response cannot restore stale enabled state', async ({ page }) => {
  await setup(page)
  await page.getByRole('link', { name: 'Settings', exact: true }).click()
  await expect(badge(page)).toHaveAttribute('data-state', 'disabled')
  let started, release
  const received = new Promise(resolve => { started = resolve })
  const pending = new Promise(resolve => { release = resolve })
  await page.route('**/api/deploy/config', async route => {
    started(); await pending
    await route.fulfill({ json: executionConfig }).catch(() => {})
  }, { times: 1 })
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await received
  await page.getByRole('link', { name: 'Settings', exact: true }).click()
  await expect(badge(page)).toHaveAttribute('data-state', 'disabled')
  release()
  await expect(badge(page)).toHaveAttribute('data-state', 'disabled')
})

test('live configuration agrees through Vite and across all three pages on desktop/mobile', async ({ page }) => {
  test.skip(process.env.DEPLOYFORGE_READ_ONLY_CONFIG !== '1', 'Opt-in GET-only live configuration audit')
  let prohibited = 0
  await page.route('**/api/**', route => {
    if (new URL(route.request().url()).pathname.startsWith('/api/session')) return route.continue();
    if (route.request().method() !== 'GET') { prohibited++; return route.abort() }
    return route.continue()
  })
  const direct = await page.request.get('http://127.0.0.1:3001/api/deploy/config')
  const proxy = await page.request.get('/api/deploy/config')
  expect(direct.status()).toBe(200); expect(proxy.status()).toBe(200)
  const config = await direct.json()
  expect(await proxy.json()).toEqual(config)
  expect(proxy.headers()['cache-control']).toBe('no-store')
  const key = config.executionEnabled ? 'enabled' : 'disabled'
  await page.goto('/')
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 844 })
    for (const name of ['Overview', 'Deployments', 'Settings']) {
      await page.getByRole('link', { name, exact: true }).click()
      if (name === 'Overview') {
        await expect(badge(page)).toHaveCount(0)
        await expect(page.getByRole('button', { name: 'Refresh configuration', exact: true })).toHaveCount(0)
        continue
      }
      await expect(badge(page)).toHaveAttribute('data-state', key)
      await expect(badge(page)).toContainText(`Server authentication: ${config.authenticationConfigured ? 'Configured' : 'Missing'}`)
      await expect(badge(page)).not.toContainText('Waiting for API response')
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
      await page.screenshot({ path: `/private/tmp/deployforge-step1-${name.toLowerCase()}-${width}.png`, fullPage: true })
    }
  }
  expect(prohibited).toBe(0)
})
