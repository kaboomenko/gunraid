import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DRIFT_LAYOUT } from './snow-drift';
import { driftClips, driftPlaceholderCss } from './snow-drift-css';

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

  it('the canvas band is as tall as the module draws it', () => {
    const css = readFileSync(GLOBALS, 'utf8');
    expect(css).toContain(`height: calc(${DRIFT_LAYOUT.band}px * var(--snow-k));`);
  });

  it('placeholder clipping follows the canvas quiet zones within 1 px', () => {
    const clips = driftClips();
    expect(clips.length).toBeGreaterThan(0);
    for (const c of clips) expect(c.maxErr).toBeLessThan(1);
  });
});
