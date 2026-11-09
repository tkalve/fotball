import { defineConfig, devices } from '@playwright/test'

/**
 * Two-player end-to-end harness. Boots the real stack — `wrangler dev` for the
 * GameHub Durable Object and `vite dev` for the app (which proxies /ws to the
 * worker) — then drives two browser contexts through a networked match.
 *
 * WebGL runs headlessly via SwiftShader, and the game exposes `window.fotball`
 * in dev builds, so the specs drive and inspect the engine directly instead of
 * picking pixels.
 */
export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npm run dev',
      cwd: '../api',
      url: 'http://localhost:8787/',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: 'npm run dev',
      url: 'http://localhost:5173/',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
})
