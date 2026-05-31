// Playwright config for tickets-please browser verification.
// Dev-only tooling — the shipped game remains zero-dependency.
//
// Auto-starts the project's own zero-dep static server (tools/serve.js) on a
// dedicated port and points the browser at it. See .claude/skills/browser-verify.

import { defineConfig, devices } from '@playwright/test';

const PORT = 8788;

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // Build the shippable dist/ first, then serve THAT — so e2e exercises the
    // exact artifact that goes to production (no path-resolution divergence).
    command: `node tools/build.js && node tools/serve.js ${PORT} dist`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
