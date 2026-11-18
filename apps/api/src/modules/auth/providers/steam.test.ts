import { describe, expect, it, vi } from 'vitest';
import { STEAM_OPENID_ENDPOINT, buildSteamLoginUrl, verifySteamAssertion } from './steam.js';

const RETURN_TO = 'http://localhost:8080/api/v1/auth/steam/callback?state=abc';
const STEAM_ID = '76561198000000001';

function assertion(overrides: Record<string, string> = {}) {
  return {
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'id_res',
    'openid.op_endpoint': STEAM_OPENID_ENDPOINT,
    'openid.claimed_id': `https://steamcommunity.com/openid/id/${STEAM_ID}`,
    'openid.identity': `https://steamcommunity.com/openid/id/${STEAM_ID}`,
    'openid.return_to': RETURN_TO,
    'openid.response_nonce': '2026-11-18T00:00:00Zabc',
    'openid.assoc_handle': '1234567890',
    'openid.signed': 'signed,op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle',
    'openid.sig': 'c2lnbmF0dXJl',
    ...overrides,
  };
}

const okFetch = vi.fn(async () => new Response('ns:http://specs.openid.net/auth/2.0\nis_valid:true\n'));

describe('steam openid', () => {
  it('builds a login url with return_to and realm', () => {
    const url = new URL(buildSteamLoginUrl(RETURN_TO, 'http://localhost:8080'));
    expect(url.origin + url.pathname).toBe(STEAM_OPENID_ENDPOINT);
    expect(url.searchParams.get('openid.return_to')).toBe(RETURN_TO);
    expect(url.searchParams.get('openid.mode')).toBe('checkid_setup');
  });

  it('accepts a valid assertion confirmed by Steam', async () => {
    await expect(verifySteamAssertion(assertion(), RETURN_TO, okFetch)).resolves.toBe(STEAM_ID);
    const body = String((okFetch.mock.calls[0] as unknown as [string, RequestInit])[1].body);
    expect(body).toContain('openid.mode=check_authentication');
  });

  it('rejects when Steam says is_valid:false', async () => {
    const bad = vi.fn(async () => new Response('is_valid:false\n'));
    await expect(verifySteamAssertion(assertion(), RETURN_TO, bad)).resolves.toBeNull();
  });

  it('rejects mismatched return_to, foreign claimed_id and missing signed fields', async () => {
    await expect(
      verifySteamAssertion(assertion({ 'openid.return_to': 'http://evil.test/cb' }), RETURN_TO, okFetch),
    ).resolves.toBeNull();
    await expect(
      verifySteamAssertion(
        assertion({
          'openid.claimed_id': 'https://evil.test/openid/id/76561198000000001',
          'openid.identity': 'https://evil.test/openid/id/76561198000000001',
        }),
        RETURN_TO,
        okFetch,
      ),
    ).resolves.toBeNull();
    await expect(
      verifySteamAssertion(assertion({ 'openid.signed': 'signed,claimed_id' }), RETURN_TO, okFetch),
    ).resolves.toBeNull();
  });
});
