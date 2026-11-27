import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const CSS = readFileSync(fileURLToPath(new URL('../app/globals.css', import.meta.url)), 'utf8');

describe('case page CSS', () => {
  it('limits the tile mode (card ≤ 130) to the roulette lanes', () => {
    // Иначе карточки телефона — 90 (дроплента) и 108 (содержимое, окно результата, груз) — остались бы без текстов.
    const block = /@container skin-card \(max-width: 130px\) \{([\s\S]*?)\n {2}\}/.exec(CSS)?.[1];
    expect(block).toBeDefined();
    const selectors = [...(block ?? '').matchAll(/([^{}]+)\{/g)].flatMap((m) =>
      (m[1] ?? '').split(',').map((s) => s.trim()),
    );
    expect(selectors.length).toBeGreaterThan(0);
    for (const s of selectors) expect(s).toMatch(/^\.case-lane__track /);
  });

  it('keeps no phone tiers of the scene (the phone block replaces them)', () => {
    expect(CSS).not.toMatch(/@container case-stage \(max-width: (479|599)\.98px\)/);
  });
});
