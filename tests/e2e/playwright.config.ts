import { defineConfig, devices } from '@playwright/test';

/**
 * E2E по критериям готовности (раздел 16 ТЗ). Гоняется против поднятого стека:
 *   docker compose up -d --build && pnpm e2e
 * E2E_BASE_URL — адрес сайта (по умолчанию Caddy из compose).
 * PW_CHROMIUM_PATH — свой Chromium, если браузеры Playwright не установлены.
 */
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;
const ci = Boolean(process.env.CI);

export default defineConfig({
  testDir: './specs',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  // Общая БД и лимиты запросов: последовательно, файлы по алфавиту (сверка ledger — последней).
  fullyParallel: false,
  workers: 1,
  retries: ci ? 1 : 0,
  forbidOnly: ci,
  reporter: ci ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8080',
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
    trace: ci ? 'on-first-retry' : 'off',
    screenshot: 'only-on-failure',
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 900 } },
    },
    {
      // Мобильный прогон ключевых сценариев (теги @mobile).
      name: 'mobile',
      grep: /@mobile/,
      use: { ...devices['Pixel 7'] },
    },
  ],
});
