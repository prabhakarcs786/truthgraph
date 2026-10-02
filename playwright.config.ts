import { defineConfig } from "@playwright/test";

const liveUi = process.env.PLAYWRIGHT_LIVE_UI === "1";
const port = liveUi ? 3102 : 3101;
const baseURL = process.env.PLAYWRIGHT_BASE_URL || `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests",
  testMatch: liveUi ? "**/live-upload.spec.ts" : "**/workspace.spec.ts",
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: { baseURL, browserName: "chromium", trace: "retain-on-failure", reducedMotion: "reduce" },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL ? undefined : { command: `npm run ${liveUi ? "start" : "dev"} -- --hostname 127.0.0.1 --port ${port}`, url: baseURL, reuseExistingServer: !liveUi && !process.env.CI, env: { APP_MODE: liveUi ? "live" : "demo" }, timeout: 120_000 },
});