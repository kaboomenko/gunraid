import type { PublicConfigDto } from '@gunraid/shared';
import { expect, test } from '../fixtures';

test.describe('Публичная часть', () => {
  test('главная обеих игр и переключатель игры @mobile', async ({ page, api }) => {
    const config = (await api.get<PublicConfigDto>('/config')).body;
    const other = config.games.find((g) => g.code !== config.defaultGame);
    expect(other, 'в сидах две игры').toBeTruthy();

    await page.goto('/');
    await expect(page).toHaveURL(new RegExp(`/${config.defaultGame}$`));
    await expect(page.locator('[data-testid^="case-card-"]').first()).toBeVisible();

    await page.getByRole('button', { name: 'Выбрать игру' }).click();
    await page.getByRole('menuitemradio', { name: other!.name }).click();
    await expect(page).toHaveURL(new RegExp(`/${other!.code}$`));
    await expect(page.locator('[data-testid^="case-card-"]').first()).toBeVisible();

    // Выбор запоминается: «/» ведёт в последнюю игру.
    await page.goto('/');
    await expect(page).toHaveURL(new RegExp(`/${other!.code}$`));
  });

  test('гость: открыть кейс — сначала войти', async ({ page, api }) => {
    const c = await api.cheapestCase('cs2');
    await page.goto(`/cs2/case/${c.slug}`);
    await expect(page.getByTestId('case-open')).toHaveCount(0);
    // Гостю — та же лаймовая «Открыть за N», но она ведёт ко входу.
    const open = page.getByTestId('case-open-login');
    await expect(open).toContainText(`Открыть за ${c.price}`);
    await open.click();
    await expect(page.getByTestId('dev-login-player')).toBeVisible();
    // Окно закрыто — фокус снова на кнопке, а не в начале страницы.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('login-modal')).toHaveCount(0);
    await expect(open).toBeFocused();
  });

  test('правовые страницы и FAQ @mobile', async ({ page }) => {
    await page.goto('/legal/terms');
    await expect(page.getByTestId('legal-doc')).toContainText('TODO: юрист');
    for (const slug of ['privacy', 'rules', 'age', 'responsible']) {
      const res = await page.goto(`/legal/${slug}`);
      expect(res?.status()).toBe(200);
      await expect(page.getByTestId('legal-doc')).toBeVisible();
    }
    await page.goto('/faq');
    const items = page.getByTestId('faq-list').locator('details');
    expect(await items.count()).toBeGreaterThan(5);
    await items.first().locator('summary').click();
    await expect(items.first().locator('p')).toBeVisible();
    await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(1);
  });

  test('SEO: sitemap, robots, мета-теги и CSP', async ({ page, request }) => {
    const robots = await (await request.get('/robots.txt')).text();
    expect(robots).toContain('Disallow: /admin');
    expect(robots).toMatch(/Sitemap: \S+\/sitemap\.xml/);

    const sitemap = await (await request.get('/sitemap.xml')).text();
    expect(sitemap).toMatch(/\/cs2\/case\//);
    expect(sitemap).toMatch(/\/standoff2\/items\//);
    expect(sitemap).toContain('/legal/terms');

    const res = await page.goto('/standoff2');
    const csp = res?.headers()['content-security-policy'] ?? '';
    expect(csp).toMatch(/script-src [^;]*'nonce-/);
    expect(csp).toContain("object-src 'none'");
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
      'content',
      /\/brand\/og\.png$/,
    );
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/standoff2$/);
  });

  test('cookie-баннер показывается один раз', async ({ page }) => {
    await page.goto('/faq');
    const banner = page.getByTestId('cookie-banner');
    await expect(banner).toBeVisible();
    await expect(banner.getByRole('link')).toHaveAttribute('href', '/legal/cookies');
    await expect(banner.getByRole('button', { name: 'Отклонить' })).toBeVisible();
    await banner.getByRole('button', { name: 'Принять все' }).click();
    await expect(banner).toBeHidden();
    await page.reload();
    await expect(page.getByTestId('faq-list')).toBeVisible();
    await expect(banner).toBeHidden();
  });

  test('несуществующий кейс — 404', async ({ page }) => {
    const res = await page.goto('/cs2/case/no-such-case-e2e');
    expect(res?.status()).toBe(404);
  });
});
