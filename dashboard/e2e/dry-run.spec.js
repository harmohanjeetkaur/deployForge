import { test, expect } from '@playwright/test'
import assert from 'node:assert/strict'
import { randomUUID, createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import childProcess from 'node:child_process'
import { promisify } from 'node:util'
import { syncBuiltinESMExports } from 'node:module'

const target = '210426be6d6da6c2e16f234db410f83a0c98bbd2'
const current = '5b6d2c0589ab9e4a6dedbde072a95ccf124921aa'
const repo = 'ghcr.io/harmohanjeetkaur/deployforge'
const localToken = randomUUID()
const live = process.env.DEPLOYFORGE_LIVE_CHECK === '1'
const commandLog = []
let server, api

// Guard every backend subprocess in the live test: fail before any mutation.
const originalExec = childProcess.execFile
const runOriginal = promisify(originalExec)
function checkCommand(command, args) {
  commandLog.push({ command, args })
  assert.ok(command === 'git' || command === 'kubectl', 'unexpected subprocess')
  if (command === 'git') assert.ok(['symbolic-ref', 'status', 'rev-parse'].includes(args[0]), 'dry-run attempted a Git mutation or fetch')
  if (command === 'kubectl') assert.equal(args[0], 'get', 'dry-run attempted a Kubernetes mutation')
}

function git(...args) { return execFileSync('git', args, { encoding: 'utf8' }).trim() }
function deployment() { return JSON.parse(execFileSync('kubectl', ['get', 'deployment', 'deployforge', '-n', 'deployforge-gitops', '-o', 'json'], { encoding: 'utf8', timeout: 15000 })) }
async function snapshot() {
  const d = deployment()
  return {
    valuesHash: createHash('sha256').update(await readFile('../helm/deployforge/values.yaml')).digest('hex'),
    head: git('rev-parse', 'HEAD'),
    refs: git('show-ref'),
    index: git('ls-files', '--stage'),
    tracked: git('status', '--porcelain', '-uno'),
    uid: d.metadata.uid,
    generation: d.metadata.generation,
    resourceVersion: d.metadata.resourceVersion,
    spec: d.spec,
  }
}

test.beforeAll(async () => {
  if (!live) return
  assert.equal(process.env.DEPLOYFORGE_ENABLE_DEPLOY, undefined, 'live dry-run checks require deployment mode unset; never alter it')
  process.env.DEPLOYFORGE_DEPLOY_TOKEN = localToken
  function guardedExec(command, args, ...rest) {
    checkCommand(command, args)
    return originalExec(command, args, ...rest)
  }
  guardedExec[promisify.custom] = (command, args, options) => {
    checkCommand(command, args)
    return runOriginal(command, args, options)
  }
  childProcess.execFile = guardedExec
  syncBuiltinESMExports()
  const { app } = await import('../server/index.js')
  server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)) })
  api = `http://127.0.0.1:${server.address().port}`
})
test.afterAll(async () => {
  childProcess.execFile = originalExec
  syncBuiltinESMExports()
  if (server) await new Promise(resolve => server.close(resolve))
})

async function openVersions(page) {
  await page.goto('/')
  await page.getByRole('link', { name: 'Deployments', exact: true }).click()
  await expect(page.getByText('Dry-run mode (default)', { exact: true })).toBeVisible()
  await page.locator('input[type=password]').fill(localToken)
  await page.locator('#version-select').selectOption('ghcr-ghcr-210426be')
}
async function verifyAndConfirm(page) {
  await page.getByRole('button', { name: 'Verify Image Availability', exact: true }).click()
  await expect(page.getByText('✓ Image verified in GHCR', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Deploy Version', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Confirm Deployment' })).toBeVisible()
  await expect(page.locator('.deploy-confirm-warning')).toHaveText('Dry run: validates only. No files, commits, pushes or Kubernetes changes.')
  await expect(page.locator('.deploy-confirm-details')).toContainText(target)
  await page.getByRole('button', { name: 'Confirm Deploy', exact: true }).click()
}

test('live GHCR + Git + Kubernetes dry-run API and browser, with mutation guards', async ({ page }) => {
  test.skip(!live, 'Opt-in read-only GHCR/cluster check: DEPLOYFORGE_LIVE_CHECK=1')
  const before = await snapshot()
  expect(before.tracked).toBe('')
  expect(git('symbolic-ref', '--short', 'HEAD')).toBe('main')
  expect(git('rev-parse', 'refs/remotes/origin/main')).toBe(before.head)
  expect(before.spec.template.spec.containers.find(c => c.name === 'deployforge').image).toBe(`${repo}:${current}`)
  expect(target).not.toBe(current)
  const headers = { Origin: 'http://localhost:5173', Authorization: `Bearer ${localToken}`, 'Content-Type': 'application/json' }
  const call = async (path, options = {}) => {
    const response = await fetch(`${api}${path}`, options)
    return { code: response.status, body: await response.json(), headers: response.headers }
  }
  expect((await call('/api/deploy/config')).body).toEqual({ dryRun: true })
  const image = await call(`/api/images/verify/${target}`)
  expect(image.body).toMatchObject({ valid: true, exists: true, platformsSupported: true, hasAmd64: true, hasArm64: true })
  const post = (body, extraHeaders = headers) => call('/api/deploy', { method: 'POST', headers: extraHeaders, body: typeof body === 'string' ? body : JSON.stringify(body) })
  expect((await post({ tag: target }, { ...headers, Authorization: '' })).code).toBe(401)
  expect((await post({ tag: target }, { ...headers, Authorization: 'Bearer incorrect' })).code).toBe(401)
  expect((await post({ tag: target }, { ...headers, Origin: 'https://example.invalid' })).code).toBe(403)
  expect((await post({ tag: target }, { ...headers, Origin: '' })).code).toBe(403)
  expect((await post({})).code).toBe(400)
  expect((await post('{invalid')).body.error).toBe('Invalid request body')
  const invalid = await post({ tag: 'latest' })
  expect(invalid.code).toBe(400)
  expect(invalid.body.state).toBe('failed')
  const same = await post({ tag: current })
  expect(same.code).toBe(400)
  expect(same.body.message).toContain('already deployed')
  const result = await post({ tag: target })
  expect(result.code).toBe(200)
  expect(result.body).toMatchObject({ state: 'dry-run', success: true, dryRun: true, tag: target, currentTag: current })
  expect(result.headers.get('access-control-allow-origin')).toBe('http://localhost:5173')
  expect((await call(`/api/deploy/status/${target}?id=${result.body.id}`)).body).toEqual(result.body)
  expect((await call(`/api/deploy/status/${target}?id=wrong`)).code).toBe(404)
  expect((await call(`/api/deploy/status/${current}`)).code).toBe(404)
  // Proxy the browser to the isolated server, preserving browser Origin and auth.
  // Existing processes on ports 3001/5173 are not restarted or reconfigured.
  await page.route('**/api/**', async route => {
    const request = route.request()
    const url = new URL(request.url())
    const response = await fetch(`${api}${url.pathname}${url.search}`, {
      method: request.method(), headers: request.headers(),
      body: request.method() === 'GET' ? undefined : request.postData(),
    })
    await route.fulfill({ status: response.status, contentType: 'application/json', body: await response.text() })
  })
  await openVersions(page)
  await verifyAndConfirm(page)
  await expect(page.getByRole('status')).toHaveText('Dry run complete')
  await expect(page.getByRole('button', { name: 'Deploy Version', exact: true })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Deploying...', exact: true })).toHaveCount(0)
  await page.locator('#version-select').selectOption('')
  await expect(page.getByRole('status')).toHaveText('Ready')
  await expect(page.locator('.verification-result')).toHaveCount(0)
  await expect(page.locator('.modal-overlay')).toHaveCount(0)
  const after = await snapshot()
  expect(after).toEqual(before)
  expect(commandLog.some(c => c.command === 'git')).toBe(true)
  expect(commandLog.some(c => c.command === 'kubectl')).toBe(true)
  console.log(JSON.stringify({ liveDryRun: 'passed', target, valuesHash: after.valuesHash, head: after.head, deploymentGeneration: after.generation, deploymentResourceVersion: after.resourceVersion, backendCommands: commandLog.map(c => `${c.command} ${c.args[0]}`) }))
})

async function mockApi(page, deployResponse) {
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url())
    let body
    if (url.pathname === '/api/deploy/config') body = { dryRun: true }
    else if (url.pathname === '/api/kubernetes/status') body = { currentImage: `${repo}:${current}`, desiredReplicas: 3, readyReplicas: 3, pods: [] }
    else if (url.pathname === '/api/kubernetes/history') body = []
    else if (url.pathname.startsWith('/api/images/verify/')) body = { valid: true, exists: true, platformsSupported: true }
    else if (url.pathname === '/api/deploy') return deployResponse(route)
    else throw new Error(`Unexpected request ${url.pathname}`)
    await route.fulfill({ json: body })
  })
}

test('API error clears Deploying, shows failure, and resets on version change', async ({ page }) => {
  await mockApi(page, route => route.fulfill({ status: 400, json: { state: 'failed', message: 'Tracked or staged changes exist' } }))
  await openVersions(page)
  await verifyAndConfirm(page)
  await expect(page.getByRole('status')).toHaveText('Deployment failed')
  await expect(page.locator('.preview-error')).toHaveText('Tracked or staged changes exist')
  await expect(page.getByRole('button', { name: 'Deploy Version', exact: true })).toBeEnabled()
  await page.locator('#version-select').selectOption('')
  await expect(page.getByRole('status')).toHaveText('Ready')
  await expect(page.locator('.preview-error')).toHaveCount(0)
})

test('changing version during request discards late results and clears busy state', async ({ page }) => {
  let received, release
  const started = new Promise(resolve => { received = resolve })
  const delayed = new Promise(resolve => { release = resolve })
  await mockApi(page, async route => {
    received()
    await delayed
    await route.fulfill({ json: { state: 'dry-run', dryRun: true, success: true, tag: target, message: 'Stale result' } }).catch(() => {})
  })
  await openVersions(page)
  await verifyAndConfirm(page)
  await started
  await expect(page.getByRole('status')).toHaveText('Deployment requested')
  await page.locator('#version-select').selectOption('')
  release()
  await expect(page.getByRole('status')).toHaveText('Ready')
  await expect(page.getByText('Stale result', { exact: true })).toHaveCount(0)
  await page.locator('#version-select').selectOption('ghcr-ghcr-210426be')
  await expect(page.getByRole('button', { name: 'Verify Image Availability', exact: true })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Deploying...', exact: true })).toHaveCount(0)
})

test('changing version during verification discards old verification response', async ({ page }) => {
  let received, release
  const started = new Promise(resolve => { received = resolve })
  const delayed = new Promise(resolve => { release = resolve })
  await mockApi(page, () => { throw new Error('must not deploy') })
  await page.route('**/api/images/verify/**', async route => {
    received()
    await delayed
    await route.fulfill({ json: { valid: true, exists: true, platformsSupported: true } })
  })
  await openVersions(page)
  await page.getByRole('button', { name: 'Verify Image Availability', exact: true }).click()
  await started
  await page.locator('#version-select').selectOption('')
  release()
  await page.locator('#version-select').selectOption('ghcr-ghcr-210426be')
  await expect(page.getByRole('button', { name: 'Verify Image Availability', exact: true })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Deploy Version', exact: true })).toHaveCount(0)
})

test('confirmation cancel sends no deployment request and current image is blocked', async ({ page }) => {
  let requests = 0
  await mockApi(page, () => { requests++; throw new Error('must not deploy') })
  await page.route('**/api/kubernetes/history', route => route.fulfill({ json: [{ revision: '4', containerImage: `${repo}:${current}`, isCurrent: true }] }))
  await openVersions(page)
  await page.getByRole('button', { name: 'Verify Image Availability', exact: true }).click()
  await page.getByRole('button', { name: 'Deploy Version', exact: true }).click()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.locator('.modal-overlay')).toHaveCount(0)
  expect(requests).toBe(0)
  await page.locator('#version-select').selectOption('k8s-4')
  await page.getByRole('button', { name: 'Verify Image Availability', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Deploy Version', exact: true })).toBeDisabled()
  expect(requests).toBe(0)
})

test('network failure clears busy state and allows retry', async ({ page }) => {
  await mockApi(page, route => route.abort('failed'))
  await openVersions(page)
  await verifyAndConfirm(page)
  await expect(page.getByRole('status')).toHaveText('Deployment failed')
  await expect(page.locator('.preview-error')).toContainText('Failed to fetch')
  await expect(page.getByRole('button', { name: 'Deploy Version', exact: true })).toBeEnabled()
})

test('status polling displays in-progress then success without a stuck button (simulated job)', async ({ page }) => {
  await mockApi(page, route => route.fulfill({ json: { id: 'mock-job', tag: target, state: 'requested', dryRun: false, message: 'Mock deployment requested' } }))
  let polls = 0
  await page.route('**/api/deploy/status/**', route => {
    polls++
    return route.fulfill({ json: { id: 'mock-job', tag: target, dryRun: false,
      state: polls === 1 ? 'in-progress' : 'succeeded',
      message: polls === 1 ? 'Mock convergence check' : 'Mock deployment succeeded' } })
  })
  await openVersions(page)
  await verifyAndConfirm(page)
  await expect(page.getByRole('status')).toHaveText('Deployment requested')
  await expect(page.getByRole('status')).toHaveText('Deployment in progress')
  await expect(page.getByRole('status')).toHaveText('Deployment succeeded')
  await expect(page.getByRole('button', { name: 'Deploy Version', exact: true })).toBeEnabled()
  expect(polls).toBe(2)
})
