import { getRequestConfig } from 'next-intl/server';

/** Сейчас только русский; язык без префикса в URL. Новые языки — новые файлы messages/*.json. */
export const DEFAULT_LOCALE = 'ru';

export default getRequestConfig(async () => ({
  locale: DEFAULT_LOCALE,
  timeZone: 'Europe/Moscow',
  messages: (await import(`../../messages/${DEFAULT_LOCALE}.json`)).default,
}));
