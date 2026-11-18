import { describe, expect, it } from 'vitest';
import { buildCsp } from './csp';

const directives = (csp: string) =>
  Object.fromEntries(
    csp.split(';').map((d) => {
      const [name, ...rest] = d.trim().split(/\s+/);
      return [name, rest];
    }),
  ) as Record<string, string[]>;

describe('buildCsp', () => {
  it('allows only nonced scripts and no eval in production', () => {
    const d = directives(buildCsp('abc', false, ''));
    expect(d['script-src']).toContain("'nonce-abc'");
    expect(d['script-src']).toContain("'strict-dynamic'");
    expect(d['script-src']).not.toContain("'unsafe-inline'");
    expect(d['script-src']).not.toContain("'unsafe-eval'");
    expect(d['object-src']).toEqual(["'none'"]);
    expect(d['frame-ancestors']).toEqual(["'self'"]);
    expect(d['connect-src']).toEqual(["'self'"]);
  });

  it('adds eval only in dev and the socket origin when configured', () => {
    const d = directives(buildCsp('n', true, 'http://localhost:4000'));
    expect(d['script-src']).toContain("'unsafe-eval'");
    expect(d['connect-src']).toEqual(["'self'", 'http://localhost:4000', 'ws://localhost:4000']);
  });
});
