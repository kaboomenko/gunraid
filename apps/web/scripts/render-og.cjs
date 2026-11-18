/**
 * Рендер статической OG-картинки (1200×630) → public/brand/og.png.
 * Только собственные ассеты GunRaid (логотип, шрифты Tektur/Golos) — никаких логотипов игр.
 * Запуск: node scripts/render-og.cjs (нужен Playwright с Chromium).
 */
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const font = (pkg, file) =>
  `data:font/woff2;base64,${fs.readFileSync(path.join(root, 'node_modules', pkg, 'files', file)).toString('base64')}`;
const svg = (file) =>
  `data:image/svg+xml;base64,${fs.readFileSync(path.join(root, 'public/brand', file)).toString('base64')}`;
const messages = JSON.parse(fs.readFileSync(path.join(root, 'messages/ru.json'), 'utf8'));
const tagline = messages.meta.ogTagline;
// Неразрывные пробелы, чтобы названия игр не разрывались переносом.
const taglineHtml = tagline
  .replace('Standoff 2', 'Standoff&nbsp;2')
  .replace(' и CS2', '&nbsp;и&nbsp;CS2');

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:Tektur;src:url(${font('@fontsource-variable/tektur', 'tektur-cyrillic-wght-normal.woff2')}) format('woff2');font-weight:400 900;unicode-range:U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116}
@font-face{font-family:Tektur;src:url(${font('@fontsource-variable/tektur', 'tektur-latin-wght-normal.woff2')}) format('woff2');font-weight:400 900;unicode-range:U+0000-00FF}
@font-face{font-family:Golos;src:url(${font('@fontsource-variable/golos-text', 'golos-text-cyrillic-wght-normal.woff2')}) format('woff2');font-weight:400 900;unicode-range:U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116}
@font-face{font-family:Golos;src:url(${font('@fontsource-variable/golos-text', 'golos-text-latin-wght-normal.woff2')}) format('woff2');font-weight:400 900;unicode-range:U+0000-00FF}
*{box-sizing:border-box;margin:0}
body{width:1200px;height:630px;background:#0B0B0F;color:#F2F3F5;font-family:Golos,sans-serif;overflow:hidden;position:relative}
.grid{position:absolute;inset:0;background-image:linear-gradient(rgba(198,255,0,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(198,255,0,.05) 1px,transparent 1px);background-size:48px 48px;mask-image:radial-gradient(ellipse at 75% 40%,#000 0%,transparent 70%)}
.slash{position:absolute;right:-120px;top:-80px;width:620px;height:820px;background:linear-gradient(160deg,rgba(198,255,0,.16),rgba(198,255,0,0) 60%);transform:skewX(-18deg)}
.emblem{position:absolute;right:90px;top:120px;width:360px;opacity:.95;filter:drop-shadow(0 0 60px rgba(198,255,0,.25))}
.wrap{position:absolute;left:80px;top:96px;width:640px}
.logo{height:84px}
.tag{margin-top:40px;font-size:40px;line-height:1.18;font-weight:700;letter-spacing:-.01em;text-wrap:balance}
.chips{display:flex;gap:14px;margin-top:44px}
.chip{font-family:Tektur;font-weight:700;font-size:22px;text-transform:uppercase;padding:12px 20px;background:#1B1B22;clip-path:polygon(10px 0,100% 0,100% calc(100% - 10px),calc(100% - 10px) 100%,0 100%,0 10px)}
.chip.a{background:#C6FF00;color:#0B0B0F}
.bar{position:absolute;left:0;right:0;bottom:0;height:10px;background:#C6FF00}
</style></head><body>
<div class="grid"></div><div class="slash"></div>
<img class="emblem" src="${svg('emblem.svg')}">
<div class="wrap">
  <img class="logo" src="${svg('logo.svg')}">
  <div class="tag">${taglineHtml}</div>
  <div class="chips"><span class="chip a">Provably Fair</span><span class="chip">Standoff 2</span><span class="chip">CS2</span><span class="chip">18+</span></div>
</div>
<div class="bar"></div>
</body></html>`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  const out = path.join(root, 'public/brand/og.png');
  await page.screenshot({ path: out, type: 'png' });
  await browser.close();
  console.log('written', out);
})();
