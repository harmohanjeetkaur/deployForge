import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

// Opt-in captures from fully intercepted browser tests, never a live operation.
export async function captureDocumentation(page, name) {
  if (process.env.DEPLOYFORGE_DOC_SCREENSHOTS !== '1') return
  const directory = resolve(import.meta.dirname, '../../docs/images/testing')
  await mkdir(directory, { recursive: true })
  const marker = await page.evaluateHandle(() => {
    const element = document.createElement('div')
    element.textContent = 'AUTOMATED TEST · MOCKED INTEGRATIONS · NO LIVE DEPLOYMENT'
    element.style.cssText = 'position:fixed;top:8px;right:16px;z-index:2147483647;padding:8px 12px;background:#fff4dd;border:1px solid #e6c47d;border-radius:6px;color:#745222;font:11px system-ui;pointer-events:none'
    document.body.append(element)
    return element
  })
  try { await page.screenshot({ path: resolve(directory, `${name}-mock.png`), fullPage: true }) }
  finally { await marker.evaluate(element => element.remove()); await marker.dispose() }
}
