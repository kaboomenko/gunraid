import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { AppError } from './app-error.js';
import { ZodPipe, unsafeTextPaths } from './zod.js';

describe('unsafeTextPaths', () => {
  it('finds NUL and unpaired surrogates in nested strings and keys; emoji and other values are fine', () => {
    expect(
      unsafeTextPaths({
        name: 'ok \ud83c\udf81',
        list: ['a', 'b\u0000', { deep: ['\ud800'] }],
        nested: { ['k\u0000']: 'v', ok: 1, flag: true, none: null, at: new Date(0) },
      }),
    ).toEqual(['list.1', 'list.2.deep.0', 'nested.k\u0000']);
    expect(unsafeTextPaths('\udc00')).toEqual(['']);
    expect(unsafeTextPaths({ a: 'x', b: [1, 2, 'y'] })).toEqual([]);
  });

  it('walks deep values without recursion and stops at the limit', () => {
    let deep: unknown = 'bad\u0000';
    for (let i = 0; i < 50_000; i++) deep = [deep];
    expect(unsafeTextPaths(deep)).toHaveLength(1);
    expect(
      unsafeTextPaths(
        Array.from({ length: 100 }, () => '\u0000'),
        5,
      ),
    ).toHaveLength(5);
  });
});

describe('ZodPipe', () => {
  const pipe = new ZodPipe(z.object({ reason: z.string().trim().min(3) }).strict());

  it('rejects text PostgreSQL cannot store with 400 VALIDATION_ERROR and the field path', () => {
    for (const reason of ['abc\u0000', 'abc\ud800']) {
      let err: unknown = null;
      try {
        pipe.transform({ reason });
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(AppError);
      expect(err).toMatchObject({
        code: 'VALIDATION_ERROR',
        status: 400,
        details: [{ path: 'reason', code: 'invalid_text' }],
      });
    }
  });

  it('passes ordinary text through (schema transforms included)', () => {
    expect(pipe.transform({ reason: '  причина \ud83d\ude00 ' })).toEqual({
      reason: 'причина \ud83d\ude00',
    });
  });
});
