import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./browser",
  workers: 1,
  use: { baseURL: "http://127.0.0.1:18650", headless: true },
  webServer: { command: "node test/support/server.mjs", url: "http://127.0.0.1:18650", reuseExistingServer: false },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }, { name: "firefox", use: { browserName: "firefox" } }],
});
