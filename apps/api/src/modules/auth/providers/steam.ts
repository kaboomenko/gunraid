/**
 * Steam OpenID 2.0 без сторонних стратегий:
 * 1) редирект на steamcommunity.com/openid/login;
 * 2) на callback — проверка полей и подписи через check_authentication.
 */
export const STEAM_OPENID_ENDPOINT = 'https://steamcommunity.com/openid/login';
const CLAIMED_ID_RE = /^https?:\/\/steamcommunity\.com\/openid\/id\/(7656119\d{10})$/;
const IDENTIFIER_SELECT = 'http://specs.openid.net/auth/2.0/identifier_select';

export function buildSteamLoginUrl(returnTo: string, realm: string): string {
  const params = new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'checkid_setup',
    'openid.return_to': returnTo,
    'openid.realm': realm,
    'openid.identity': IDENTIFIER_SELECT,
    'openid.claimed_id': IDENTIFIER_SELECT,
  });
  return `${STEAM_OPENID_ENDPOINT}?${params.toString()}`;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Возвращает steamID64 или null, если ответ Steam не прошёл проверку. */
export async function verifySteamAssertion(
  query: Record<string, string | undefined>,
  expectedReturnTo: string,
  fetchImpl: FetchLike = fetch,
): Promise<string | null> {
  if (query['openid.mode'] !== 'id_res') return null;
  if (query['openid.op_endpoint'] !== STEAM_OPENID_ENDPOINT) return null;
  const returnTo = query['openid.return_to'];
  if (!returnTo || returnTo !== expectedReturnTo) return null;
  const claimed = query['openid.claimed_id'];
  const identity = query['openid.identity'];
  if (!claimed || claimed !== identity) return null;
  const match = CLAIMED_ID_RE.exec(claimed);
  if (!match?.[1]) return null;
  const signed = (query['openid.signed'] ?? '').split(',');
  for (const required of ['op_endpoint', 'claimed_id', 'identity', 'return_to', 'response_nonce', 'assoc_handle']) {
    if (!signed.includes(required)) return null;
  }

  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (k.startsWith('openid.') && typeof v === 'string') body.set(k, v);
  }
  body.set('openid.mode', 'check_authentication');
  try {
    const res = await fetchImpl(STEAM_OPENID_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (!/^is_valid\s*:\s*true\s*$/m.test(text)) return null;
  } catch {
    return null;
  }
  return match[1];
}

export interface SteamProfile {
  nickname: string;
  avatarUrl: string | null;
}

export async function fetchSteamProfile(
  steamId: string,
  apiKey: string | undefined,
  fetchImpl: FetchLike = fetch,
): Promise<SteamProfile | null> {
  if (!apiKey) return null;
  try {
    const url = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${encodeURIComponent(apiKey)}&steamids=${steamId}`;
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      response?: { players?: Array<{ personaname?: string; avatarfull?: string }> };
    };
    const p = json.response?.players?.[0];
    if (!p?.personaname) return null;
    return { nickname: p.personaname, avatarUrl: p.avatarfull ?? null };
  } catch {
    return null;
  }
}
