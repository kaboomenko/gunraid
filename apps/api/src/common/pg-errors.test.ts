import { DrizzleQueryError } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { errorText, pgErrorCode } from './pg-errors.js';

/** Ошибка драйвера pg: message, code и detail (в detail бывают значения строки). */
const pgError = (code: string, message: string) =>
  Object.assign(new Error(message), { code, detail: 'Key (user_id)=(winner-id) is not present' });

describe('errorText', () => {
  it('drizzle query error: pg code and cause, never the SQL or its parameters', () => {
    const err = new DrizzleQueryError(
      'insert into "user_items" ("id", "user_id") values ($1, $2)',
      ['item-id', 'winner-id'],
      pgError('55P03', 'canceling statement due to lock timeout'),
    );
    // Так drizzle и пишет: SQL и параметры (id победителя) — в message, ошибка pg — только в cause.
    expect(err.message).toContain('winner-id');
    expect(errorText(err)).toBe('[55P03] canceling statement due to lock timeout');
    expect(pgErrorCode(err)).toBe('55P03');
  });

  it('query error without a pg code (pool timeout) or without a cause', () => {
    const pool = new DrizzleQueryError(
      'select "id" from "cargo_templates"',
      [],
      new Error('timeout exceeded when trying to connect'),
    );
    expect(errorText(pool)).toBe('timeout exceeded when trying to connect');
    const bare = new DrizzleQueryError('select 1 where "id" = $1', ['winner-id']);
    expect(errorText(bare)).toBe('Failed query');
  });

  it('other errors — message as is (with the pg code if there is one)', () => {
    expect(errorText(new Error('boom'))).toBe('boom');
    expect(errorText('plain')).toBe('plain');
    expect(errorText(pgError('23505', 'duplicate key value violates unique constraint "x"'))).toBe(
      '[23505] duplicate key value violates unique constraint "x"',
    );
  });
});
