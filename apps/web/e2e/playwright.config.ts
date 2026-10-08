import { defineConfig, devices } from '@playwright/test';

/**
 * The app is built once (vite build in apps/web) and served by `vite preview`.
 * No test talks to the live database: fixtures.ts answers every Supabase call.
 */
export default defineConfig({
  testDir: '.',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'report' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npx vite preview --port 4173 --strictPort --host 127.0.0.1',
    cwd: '..',
    url: 'http://127.0.0.1:4173/table',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    { name: 'phone-360', use: { ...devices['Pixel 5'], viewport: { width: 360, height: 760 } } },
    { name: 'tablet-768', use: { viewport: { width: 768, height: 1024 } } },
    { name: 'desktop-1280', use: { viewport: { width: 1280, height: 800 } } },
  ],
});
