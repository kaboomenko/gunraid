import { pgEnum } from 'drizzle-orm/pg-core';

export const userRoleEnum = pgEnum('user_role', ['user', 'support', 'admin']);
export const userStatusEnum = pgEnum('user_status', ['active', 'banned']);
export const authProviderEnum = pgEnum('auth_provider', ['steam', 'google', 'telegram', 'dev']);
export const accessEventEnum = pgEnum('access_event', [
  'login',
  'refresh',
  'link',
  'deposit',
  'withdraw',
]);
