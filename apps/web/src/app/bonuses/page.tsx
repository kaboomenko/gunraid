import { COOKIES } from '@gunraid/shared';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getPublicConfig } from '@/lib/server-api';

/** /bonuses → раздел выбранной игры (ссылка из футера). */
export default async function BonusesRedirect() {
  const [config, jar] = await Promise.all([getPublicConfig(), cookies()]);
  const fromCookie = jar.get(COOKIES.game)?.value;
  const game = config.games.some((g) => g.code === fromCookie) ? fromCookie : config.defaultGame;
  redirect(`/${game}/bonuses`);
}
