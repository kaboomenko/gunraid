import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DRIFT_LAYOUT, DRIFT_PHONE } from './snow-drift';
import { STRIP, driftClips, driftPlaceholderCss } from './snow-drift-css';

const GLOBALS = fileURLToPath(new URL('../app/globals.css', import.meta.url));
/** Блок между маркерами <drift-placeholder> и отступ закрывающего маркера. */
const BLOCK =
  /(\/\* <drift-placeholder>[^*]*\*\/)([\s\S]*?)\n([ \t]*)(\/\* <\/drift-placeholder> \*\/)/;
/** Сравнение без оформления: Prettier переносит строки и расставляет пробелы. */
const squash = (css: string) =>
  css
    .replace(/\s*([,:;{}()])\s*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();

describe('drift placeholder CSS', () => {
  it('globals.css holds the placeholder generated from the drift data', () => {
    const css = readFileSync(GLOBALS, 'utf8');
    const m = BLOCK.exec(css);
    expect(m).not.toBeNull();
    const fresh = driftPlaceholderCss(m?.[3] ?? '');
    if (process.env.UPDATE_DRIFT_CSS) {
      // UPDATE_DRIFT_CSS=1 pnpm --filter @gunraid/web test snow-drift-css — после правки данных сугроба
      writeFileSync(
        GLOBALS,
        css.replace(
          BLOCK,
          (_all, open: string, _old: string, indent: string, close: string) =>
            `${open}\n${fresh}\n${indent}${close}`,
        ),
      );
      return;
    }
    expect(squash(m?.[2] ?? '')).toBe(squash(fresh));
  });

  it('the strip scale in CSS is the one the placeholder is generated for', () => {
    // --snow-k связывает высоту полосы с масштабом узора: телефон (60 px) и от 768 (127 px)
    const css = readFileSync(GLOBALS, 'utf8');
    expect(css).toContain(`--snow-k: ${STRIP.phone.k};`);
    expect(css).toMatch(
      new RegExp(
        `@media \\(width >= 48rem\\) \\{\\s*\\.promo-strip \\{\\s*--snow-k: ${STRIP.md.k};`,
      ),
    );
  });

  it('the canvas band is as tall as the module draws it', () => {
    const css = readFileSync(GLOBALS, 'utf8');
    expect(css).toContain(`height: calc(${DRIFT_LAYOUT.band}px * var(--snow-k));`);
    // телефон: вся картинка эталона — по этой высоте движок и узнаёт телефонный профиль
    expect(css).toMatch(
      new RegExp(
        `@media \\(width < 48rem\\) \\{\\s*\\.promo-drift \\{\\s*height: calc\\(${DRIFT_PHONE.band}px \\* var\\(--snow-k\\)\\);`,
      ),
    );
    expect(STRIP.phone.k).toBe(DRIFT_PHONE.k);
  });

  it('placeholder clipping follows the canvas quiet zones within 1 px', () => {
    const clips = driftClips();
    expect(clips.length).toBeGreaterThan(0);
    for (const c of clips) expect(c.maxErr).toBeLessThan(1);
  });

  it('emits only clip-paths that cut something', () => {
    // многоугольник со всеми вершинами на верхнем крае ничего не срезает — такого правила быть не должно
    const css = driftPlaceholderCss('');
    const polys = [...css.matchAll(/clip-path: polygon\(([^;]*)\);/g)].map((m) => m[1]!);
    expect(polys.length).toBe(driftClips().filter((c) => c.polygon).length);
    for (const p of polys) {
      const ys = p.split(', ').map((v) => v.slice(v.lastIndexOf(' ') + 1));
      expect(ys.some((y) => y !== '0' && y !== '100%')).toBe(true);
    }
  });

  it('clips for the low-density phone canvas (halo) apply only below 48rem and 1.5 dppx', () => {
    // холст с ореолом держит запас больше — заглушка опускается так же, иначе при смене «проваливается»
    const css = driftPlaceholderCss('');
    const halo = driftClips().filter((c) => c.halo && c.polygon);
    expect(halo.length).toBeGreaterThan(0);
    expect(halo.every((c) => !c.layout.md)).toBe(true);
    const at = css.indexOf('@media (width < 48rem) and (resolution < 1.5dppx) {');
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(css.indexOf('@media (width >= 48rem) {'));
    for (const c of halo) expect(css.indexOf(c.polygon!, at)).toBeGreaterThan(at);
  });

  it('the phone underlay reaches past the strip bottom', () => {
    // верх слоя с дробной высотой Chromium округляет: без запаса нижние ~0,2 css полосы оставались без снега
    const css = driftPlaceholderCss('');
    const phone = css.slice(0, css.indexOf('@media (width >= 48rem) {'));
    expect(phone).toMatch(
      /linear-gradient\([^;]* calc\(100% - 1px\)\) left 0 bottom -1px \/ 100% calc\([\d.]+px \* var\(--snow-k\) \+ 1px\) no-repeat;/,
    );
  });

  it('phone depth copies stop at the canvas depth-shading limit, the wide strip keeps all', () => {
    const css = driftPlaceholderCss('');
    const at = css.indexOf('@media (width >= 48rem) {');
    const uses = (part: string) =>
      [...part.matchAll(/%3cuse href='%23a' y='(\d+)'/g)].map((m) => m[1]);
    // телефон: 9 и 15 px (0,1 и 0,19 — DEPTH_PHONE.depth), от 768 — 9/15/22/30
    expect(new Set(uses(css.slice(0, at)))).toEqual(new Set(['9', '15']));
    expect(new Set(uses(css.slice(at)))).toEqual(new Set(['9', '15', '22', '30']));
  });

  it('the wide-strip placeholder (from 768 px) is unchanged', () => {
    // снято до правок телефонного профиля: от 768 заглушка не меняется ни на пиксель
    const css = driftPlaceholderCss('');
    const md = css.slice(css.indexOf('@media (width >= 48rem) {'));
    expect(createHash('sha1').update(md).digest('hex')).toBe(
      'e800c8f3a32838168678ad217803219bdf079498',
    );
  });
});
