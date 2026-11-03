import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  workers: 1,
  timeout: 90000,
  expect: { timeout: 10000 },
  reporter: 'list',
  use: { baseURL: 'http://localhost:5173', channel: 'chrome', headless: true },
  webServer: {
    command: 'npm run dev -- --host localhost --port 5173 --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
  },
})
