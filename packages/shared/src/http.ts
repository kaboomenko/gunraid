/** Имена cookie и заголовков, общие для API и фронта. */
export const COOKIES = {
  access: 'gr_at',
  refresh: 'gr_rt',
  csrf: 'gr_csrf',
  game: 'gr_game',
  device: 'gr_did',
  referral: 'gr_ref',
  oauth: 'gr_oauth',
} as const;

export const HEADERS = {
  csrf: 'x-csrf-token',
  idempotency: 'idempotency-key',
  requestId: 'x-request-id',
} as const;

export const API_PREFIX = '/api/v1';
