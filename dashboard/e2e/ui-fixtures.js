import { expect } from '@playwright/test'
export const executionConfig = {
  latestOperation: null, dryRun: false, executionEnabled: true, authenticationConfigured: true,
  environment: 'docker-desktop', capabilities: { realRequests: true, rollback: true }
}
export async function openImageEntry(page) {
  if (!await page.locator('.image-entry').evaluate(element => element.open)) await page.locator('.image-entry summary').click()
}

const browserSessions = new WeakMap()
export function setSession(page, authorized) {
  browserSessions.set(page, authorized ? { state: 'authorized', csrf: 'test-csrf', expiresAt: Date.now() + 600000 } : { state: 'pending', approvalId: 'abcd1234', expiresAt: Date.now() + 120000 })
}
export function handleSession(route) {
  const path = new URL(route.request().url()).pathname
  if (path === '/api/incidents') { route.fulfill({ json: { pods: [], namespace: 'deployforge-gitops', ai: { enabled: false, configured: false } } }).catch(() => {}); return true }
  if (!path.startsWith('/api/session')) return false
  const page = route.request().frame().page()
  if (!browserSessions.has(page)) setSession(page, true)
  if (path === '/api/session/logout') setSession(page, false)
  route.fulfill({ json: browserSessions.get(page) }).catch(() => {})
  return true
}

export async function refreshSessionFixture(page, authorized) {
  setSession(page, authorized)
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.locator('.environment-chip')).toContainText(authorized ? 'Local session connected' : 'Connect local session')
}
