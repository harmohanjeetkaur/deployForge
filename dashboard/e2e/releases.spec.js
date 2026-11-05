import { test, expect } from '@playwright/test'
import { handleSession, executionConfig, setSession } from './ui-fixtures.js'
const sha = 'a'.repeat(40), digest = `sha256:${'d'.repeat(64)}`
const repository = { id: 'deployforge', name: 'DeployForge', owner: 'harmohanjeetkaur', repo: 'deployForge', environment: 'docker-desktop', namespace: 'deployforge-gitops' }
async function mock(page, { enabled = true, failure = false } = {}) {
  const state = { history: [], posts: [], ticks: 0 }
  await page.route('**/api/**', async route => {
    if (handleSession(route)) return
    const req = route.request(), url = new URL(req.url()), path = url.pathname
    if (path === '/api/deploy/config') return route.fulfill({ json: executionConfig })
    if (path === '/api/repositories') return route.fulfill({ json: { repositories: [repository], executionEnabled: enabled } })
    if (path === '/api/repositories/deployforge/sources') return route.fulfill({ json: { sources: [{ branch: 'main', sha }] } })
    if (path === '/api/repositories/deployforge/source') return route.fulfill({ json: { sha, message: 'Approved source' } })
    if (path === '/api/releases' && req.method() === 'POST') {
      state.posts.push(req.postDataJSON())
      expect(req.headers()['x-csrf-token']).toBe('test-csrf')
      const r = { id: 'release-1', repository: 'deployforge', tag: 'v1.2.0', sha, createdAt: new Date().toISOString(), state: 'ci', stage: 'ci', message: 'Waiting for actual CI' }
      state.history = [r]; return route.fulfill({ status: 202, json: r })
    }
    if (path.endsWith('/retry')) { state.posts.push('retry'); return route.fulfill({ json: state.history[0] }) }
    if (path === '/api/releases') {
      if (state.history.length) {
        state.ticks++
        if (state.ticks >= 2) Object.assign(state.history[0], failure ? { state: 'failed', stage: 'ci', failedStage: 'security', message: 'Security policy failed; no promotion was requested' } : {
          state: 'succeeded', stage: 'healthy', message: 'Release deployed and observed healthy', digest, run: { id: 123, attempt: 1, conclusion: 'success', url: 'https://github.com/harmohanjeetkaur/deployForge/actions/runs/123' }, promotion: { commit: 'c'.repeat(40) }, observation: { healthy: true, argoSynced: true, argoHealth: 'Healthy', readyReplicas: 3, desiredReplicas: 3 },
        })
      }
      return route.fulfill({ json: { releases: state.history } })
    }
    if (path === '/api/kubernetes/history') return route.fulfill({ json: [] })
    return route.fulfill({ json: {} })
  })
  await page.goto('/')
  await page.getByRole('link', { name: 'Create Release', exact: true }).click()
  return state
}
test('one click tracks complete release evidence and durable history after navigation', async ({ page }) => {
  const state = await mock(page)
  await page.getByRole('button', { name: 'Look up source commit' }).click()
  await expect(page.getByText('Approved source')).toBeVisible()
  await page.getByRole('textbox', { name: 'New release tag' }).fill('v1.2.0')
  await page.getByRole('button', { name: 'Create Tag & Deploy', exact: true }).click()
  await expect(page.getByText('Waiting for actual CI')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Create Tag & Deploy', exact: true })).toBeDisabled()
  await expect(page.getByText('Release deployed and observed healthy')).toBeVisible({ timeout: 15000 })
  expect(state.posts).toHaveLength(1)
  expect(state.posts[0]).toMatchObject({ repository: 'deployforge', ref: 'main', tag: 'v1.2.0', execution: 'real', environment: 'docker-desktop' })
  expect(state.posts[0].requestId).toMatch(/^[a-f0-9-]{36}$/)
  await expect(page.getByText(digest, { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: /Run 123/ })).toHaveAttribute('href', /actions\/runs\/123/)
  await expect(page.getByText('3/3 ready · Healthy')).toBeVisible()
  await page.getByRole('link', { name: 'Overview', exact: true }).click()
  await page.getByRole('link', { name: 'Create Release', exact: true }).click()
  await expect(page.getByText('Release deployed and observed healthy')).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})
test('disabled backend cannot create a release and never fabricates success', async ({ page }) => {
  const state = await mock(page, { enabled: false })
  await expect(page.getByRole('button', { name: 'Create Tag & Deploy', exact: true })).toBeDisabled()
  await expect(page.getByText('Release execution disabled.', { exact: false })).toBeVisible()
  await expect(page.getByText('No releases recorded.', { exact: false })).toBeVisible()
  expect(state.posts).toHaveLength(0)
})
test('security failure shows safe retry and never a deployed version', async ({ page }) => {
  const state = await mock(page, { failure: true })
  await page.getByRole('textbox', { name: 'New release tag' }).fill('v1.2.0')
  await page.getByRole('button', { name: 'Create Tag & Deploy', exact: true }).click()
  await expect(page.getByText('Security policy failed; no promotion was requested')).toBeVisible({ timeout: 15000 })
  await expect(page.getByText('Not confirmed', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Retry reconciliation' }).click()
  expect(state.posts).toHaveLength(2)
  expect(state.posts[1]).toBe('retry')
})
test('unapproved session cannot submit a release', async ({ page }) => {
  const state = await mock(page)
  setSession(page, false)
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.locator('.environment-chip')).toContainText('Connect local session')
  await page.getByRole('textbox', { name: 'New release tag' }).fill('v1.2.0')
  await page.getByRole('button', { name: 'Create Tag & Deploy', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Connect your local browser session')
  expect(state.posts).toHaveLength(0)
})
