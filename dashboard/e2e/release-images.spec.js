import { test, expect } from '@playwright/test'
import { handleSession, executionConfig } from './ui-fixtures.js'
const image = 'ghcr.io/harmohanjeetkaur/deployforge'
const sha = 'a'.repeat(40), old = 'b'.repeat(40)
test('published releases appear by version, refresh automatically and keep rollback history separate', async ({ page }) => {
  const releases = [{ repository: 'deployforge', tag: 'v1.1.1', sha, digest: `sha256:${'d'.repeat(64)}`, run: { conclusion: 'success' }, state: 'succeeded' },
    { repository: 'deployforge', tag: 'v1.1.3', sha: old, digest: `sha256:${'e'.repeat(64)}`, run: { conclusion: 'success' }, state: 'needs-review' },
    { repository: 'deployforge', tag: 'v9.0.0', sha: 'f'.repeat(40), run: { conclusion: 'failure' } }]
  const writes = []
  await page.route('**/api/**', route => {
    if (handleSession(route)) return
    const req = route.request(), path = new URL(req.url()).pathname
    if (req.method() !== 'GET') writes.push(path)
    let json = {}
    if (path === '/api/releases') json = { releases }
    if (path === '/api/repositories') json = { repositories: [{ id: 'deployforge', enabled: true, adapter: 'deployforge', image }] }
    if (path === '/api/deploy/config') json = executionConfig
    if (path === '/api/kubernetes/status') json = { currentImage: `${image}:${sha}`, readyReplicas: 3, desiredReplicas: 3, pods: [] }
    if (path === '/api/kubernetes/history') json = [{ revision: '1', deploymentRevision: '1', containerImage: `${image}:${sha}`, isCurrent: true, rollbackEligible: false }]
    if (path.startsWith('/api/images/verify/')) json = { valid: true, exists: true, platformsSupported: true }
    return route.fulfill({ json })
  })
  await page.goto('/')
  await page.getByRole('link', { name: 'Deployments', exact: true }).click()
  const select = page.locator('#version-select')
  await expect(select.locator('option', { hasText: 'v1.1.1' })).toHaveText(/Current/)
  await expect(select.locator('option', { hasText: 'v1.1.3' })).toHaveCount(1)
  await expect(select.locator('option', { hasText: 'v9.0.0' })).toHaveCount(0)
  await select.selectOption(`ghcr-release-${old}`)
  await page.getByRole('button', { name: 'Verify Image Availability', exact: true }).click()
  await expect(page.getByText('✓ Image verified in GHCR', { exact: true })).toBeVisible()
  releases.unshift({ ...releases[0], tag: 'v1.2.0', sha: 'c'.repeat(40) })
  await page.getByRole('button', { name: 'Refresh Versions' }).click()
  await expect(select.locator('option', { hasText: 'v1.2.0' })).toHaveCount(1)
  await page.getByRole('button', { name: 'Roll back a version' }).click()
  await expect(select.locator('option')).toHaveCount(2)
  expect(writes).toEqual([])
})
