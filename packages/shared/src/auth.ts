import { z } from 'zod';

export const ROLES = ['user', 'support', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export const AUTH_PROVIDERS = ['steam', 'google', 'telegram', 'dev'] as const;
export type AuthProvider = (typeof AUTH_PROVIDERS)[number];

/** Способы входа, которые можно привязать к аккаунту из профиля. */
export const LINKABLE_PROVIDERS = ['steam', 'google', 'telegram'] as const;
export type LinkableProvider = (typeof LINKABLE_PROVIDERS)[number];

export const authIntentSchema = z.enum(['login', 'link']);
export type AuthIntent = z.infer<typeof authIntentSchema>;

/** Данные Telegram Login Widget (https://core.telegram.org/widgets/login). */
export const telegramAuthSchema = z.object({
  id: z.coerce.number().int().positive(),
  first_name: z.string().max(256).optional(),
  last_name: z.string().max(256).optional(),
  username: z.string().max(64).optional(),
  photo_url: z.string().url().max(2048).optional(),
  auth_date: z.coerce.number().int().positive(),
  hash: z.string().regex(/^[a-f0-9]{64}$/),
  intent: authIntentSchema.default('login'),
});
export type TelegramAuthPayload = z.infer<typeof telegramAuthSchema>;

export const DEV_LOGIN_PRESETS = ['player', 'support', 'admin'] as const;
export type DevLoginPreset = (typeof DEV_LOGIN_PRESETS)[number];

/** Dev-вход: только при AUTH_DEV_LOGIN=true и не в production. */
export const devLoginSchema = z.object({
  preset: z.enum(DEV_LOGIN_PRESETS).default('player'),
  nickname: z
    .string()
    .trim()
    .min(2)
    .max(24)
    .regex(/^[\p{L}\p{N}_\-. ]+$/u)
    .optional(),
});
export type DevLoginBody = z.infer<typeof devLoginSchema>;

/** Безопасный путь возврата после входа: только относительный путь сайта. */
export function sanitizeReturnTo(value: unknown, fallback = '/'): string {
  if (typeof value !== 'string') return fallback;
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return fallback;
  if (value.length > 512) return fallback;
  if (value.startsWith('/api/')) return fallback;
  return value;
}
