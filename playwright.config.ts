import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'],['html',{open:'never'}]],
  // No trace/screenshots around authentication: those can contain credentials.
  use: { baseURL: process.env.E2E_BASE_URL, trace:'off', screenshot:'off' },
  projects: [
    { name:'desktop', use:{...devices['Desktop Chrome']} },
    { name:'mobile', use:{...devices['iPhone 13'],defaultBrowserType:'chromium'} },
  ],
});
