export const executionConfig = {
  dryRun: false, executionEnabled: true, authenticationConfigured: true,
  environment: 'docker-desktop', capabilities: { realRequests: true, rollback: true }
}
export async function previewIfAvailable(page) {
  const button = page.getByRole('button', { name: 'Preview Version Change', exact: true })
  if (await button.count() && await button.isEnabled()) await button.click()
}
export async function openImageEntry(page) {
  if (!await page.locator('.image-entry').evaluate(element => element.open)) await page.locator('.image-entry summary').click()
}
