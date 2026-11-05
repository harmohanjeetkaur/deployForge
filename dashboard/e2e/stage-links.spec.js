import { test, expect } from '@playwright/test'
import { handleSession, executionConfig } from './ui-fixtures.js'
const sha = 'a'.repeat(40), commit = 'c'.repeat(40)
test('deployment stage links open exact evidence and live sections without executing', async ({ page }) => {
  const writes = []
  await page.route('**/api/**', route => {
    if (handleSession(route)) return
    const request = route.request(), path = new URL(request.url()).pathname
    if (request.method() !== 'GET') writes.push(path)
    let json = {}
    if (path === '/api/deploy/config') json = { ...executionConfig, latestOperation: { id: 'operation-123', tag: sha, state: 'succeeded', operation: 'deploy', commit, pushed: true, stage: 'healthy', progress: { requestAccepted: true, commitCreated: true, argoSynced: true, rolloutReady: true, healthy: true } } }
    if (path === '/api/kubernetes/history') json = []
    if (path === '/api/releases') json = { releases: [] }
    if (path === '/api/repositories') json = { repositories: [] }
    if (path === '/api/kubernetes/status') json = { currentImage: `ghcr.io/harmohanjeetkaur/deployforge:${sha}`, readyReplicas: 3, desiredReplicas: 3, pods: [], argo: { sync: 'Synced', health: 'Healthy' } }
    return route.fulfill({ json })
  })
  await page.goto('/')
  await page.getByRole('link', { name: 'Deployments', exact: true }).click()
  const progress = page.getByRole('region', { name: 'Deployment progress', exact: true })
  await expect(progress.getByRole('link', { name: 'Request accepted', exact: true })).toHaveAttribute('href', `/api/deploy/status/${sha}?id=operation-123`)
  await expect(progress.getByRole('link', { name: 'GitOps commit', exact: true })).toHaveAttribute('href', `https://github.com/harmohanjeetkaur/deployForge/commit/${commit}`)
  for (const [title, section] of [['ArgoCD sync', 'gitops-reconciliation'], ['Kubernetes rollout', 'workload-instances'], ['Health verification', 'platform-health']]) {
    await progress.getByRole('button', { name: title, exact: true }).click()
    await expect(page.locator(`#${section}`)).toBeInViewport()
    await page.getByRole('link', { name: 'Deployments', exact: true }).click()
  }
  expect(writes).toEqual([])
})
