import { test, expect } from '@playwright/test'
import { executionConfig, handleSession, setSession, refreshSessionFixture } from './ui-fixtures.js'
test('token entry is absent; approval is required once and survives navigation', async ({ page }) => {
  setSession(page, false)
  await page.route('**/api/**', route => {
    if (handleSession(route)) return
    const path = new URL(route.request().url()).pathname
    if (route.request().method() !== 'GET') throw new Error('No operation may be submitted by this test')
    return route.fulfill({ json: path.endsWith('/config') ? executionConfig : path.endsWith('/history') ? [] : { currentImage: `ghcr.io/harmohanjeetkaur/deployforge:${'a'.repeat(40)}`, readyReplicas: 3, desiredReplicas: 3, pods: [] } })
  })
  await page.goto('/')
  await page.getByRole('link', { name: 'Deployments', exact: true }).click()
  await expect(page.locator('input[type=password]')).toHaveCount(0)
  await expect(page.getByText('Authorize Deployment', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Clear token' })).toHaveCount(0)
  await page.getByTestId('rollback-action').click()
  await expect(page.locator('.workflow-error')).toContainText('local browser session')
  await page.getByRole('link', { name: 'Settings', exact: true }).click()
  await expect(page.getByText('Approval pending', { exact: true })).toBeVisible()
  await expect(page.locator('.command-block')).toContainText('npm run authorize')
  await refreshSessionFixture(page, true)
  await page.getByRole('link', { name: 'Overview', exact: true }).click()
  await page.getByRole('link', { name: 'Deployments', exact: true }).click()
  await expect(page.locator('.environment-chip')).toContainText('Local session connected')
  await page.getByTestId('rollback-action').click()
  await expect(page.locator('.workflow-error')).toContainText('Select a version')
  await page.getByRole('link', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Disconnect browser' }).click()
  await expect(page.locator('.environment-chip')).toContainText('Connect local session')
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0)
})
