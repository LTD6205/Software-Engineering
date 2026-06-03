import { defineConfig, devices } from '@playwright/test'

// Happy-path browser tests against the running app.
//
// PREREQUISITE: the backend (http://localhost:3000/api) and the frontend
// (http://localhost:3001) must both be running, e.g. the normal dev servers:
//   (backend)  npm run start:dev      # in event-ops-backend
//   (frontend) npm run dev -- --port 3001
//
// These flows are READ-ONLY (login + navigation) so they are safe to run
// against a live/dev stack without mutating data. `webServer` reuses an
// already-running frontend; it will start one only if 3001 is free.
const BASE_URL = process.env.PW_BASE_URL || 'http://localhost:3001'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run dev -- --port 3001',
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
