'use client';

import type { DevLoginPreset } from '@gunraid/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Dialog } from 'radix-ui';
import {
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { GoogleIcon, SteamIcon, TelegramIcon } from '@/components/icons/design-icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useConfig } from '@/lib/config';
import { useErrorMessage } from '@/lib/errors';
import { ME_KEY } from '@/lib/me';
import { reconnectSocket } from '@/lib/socket';
import { usePrefs, useUi } from '@/lib/store';

type TelegramUser = Record<string, unknown>;
interface TelegramLogin {
  auth: (
    options: { bot_id: number; request_access?: 'write' },
    callback: (user: TelegramUser | false) => void,
  ) => void;
}

declare global {
  interface Window {
    Telegram?: { Login?: TelegramLogin };
  }
}

let telegramScript: Promise<TelegramLogin> | null = null;

/** Скрипт входа Telegram (тот же, что у виджета): даёт Telegram.Login.auth — окно входа без iframe-кнопки. */
function loadTelegram(): Promise<TelegramLogin> {
  if (window.Telegram?.Login) return Promise.resolve(window.Telegram.Login);
  telegramScript ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.async = true;
    script.onload = () =>
      window.Telegram?.Login ? resolve(window.Telegram.Login) : reject(new Error('telegram'));
    script.onerror = () => {
      telegramScript = null;
      reject(new Error('telegram'));
    };
    document.head.appendChild(script);
  });
  return telegramScript;
}

type Provider = 'google' | 'telegram' | 'steam';

/** Кнопки способов входа (макет): градиент слева направо в цвет окна, иконка своего цвета. */
const PROVIDERS: Array<{
  key: Provider;
  name: string;
  Icon: ComponentType<{ size?: number; className?: string }>;
  iconClass: string;
  from: string;
}> = [
  { key: 'google', name: 'Google', Icon: GoogleIcon, iconClass: 'text-[#CE0D23]', from: '#2F1E20' },
  {
    key: 'telegram',
    name: 'Telegram',
    Icon: TelegramIcon,
    iconClass: 'text-[#3BC5FF]',
    from: '#1E2A2F',
  },
  { key: 'steam', name: 'Steam', Icon: SteamIcon, iconClass: 'text-[#2B69FF]', from: '#1E232F' },
];

/**
 * Окно входа (макет): 622×457, #181821, скругление 36, поля 48 сверху и 24 по бокам и снизу.
 * Заголовок DemiBold 36 по центру; через 48 — согласие с публичной офертой (переключатель 36×24
 * #26262F, скругление 6, внутри квадрат 16×16 #B7FF00, скругление 2; через 24 — Medium 24);
 * через 48 — кнопки Google, Telegram, Steam: поля 24, иконка 24, Medium 24, скругление 6, между
 * кнопками 12. Без согласия войти нельзя: строка согласия встряхивается и появляется подсказка.
 * Способ, который не подключён на сервере, сообщает об этом. Тестовый вход — ниже, только если
 * он включён (тестовый стенд). На телефоне окно уменьшено целиком.
 */
export function LoginModal() {
  const t = useTranslations('auth');
  const tc = useTranslations('common');
  const open = useUi((s) => s.loginOpen);
  const close = useUi((s) => s.closeLogin);
  const accepted = usePrefs((s) => s.offerAccepted);
  const setAccepted = usePrefs((s) => s.setOfferAccepted);
  const config = useConfig();
  const pathname = usePathname();
  const qc = useQueryClient();
  const errorText = useErrorMessage();
  const consentRef = useRef<HTMLLabelElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [nickname, setNickname] = useState('');

  const returnTo = encodeURIComponent(pathname || '/');
  const telegram = config.auth.telegram;

  // Скрипт Telegram грузим заранее: окно входа должно открыться прямо по нажатию (иначе — блокировщик).
  useEffect(() => {
    if (open && telegram) void loadTelegram().catch(() => undefined);
  }, [open, telegram]);

  const afterLogin = async () => {
    await qc.invalidateQueries({ queryKey: ME_KEY });
    reconnectSocket();
    close();
    toast.success(t('success'));
  };

  const devLogin = async (preset: DevLoginPreset, nick?: string) => {
    setBusy(nick ? 'nick' : preset);
    try {
      await api.post('/auth/dev-login', nick ? { preset, nickname: nick } : { preset });
      await afterLogin();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  const askConsent = () => {
    const el = consentRef.current;
    if (el) {
      el.classList.remove('gr-shake');
      void el.offsetWidth; // перезапуск анимации
      el.classList.add('gr-shake');
    }
    toast.error(t('offerRequired'));
  };

  /** Адрес входа (Steam, Google — переход на сервер); у Telegram — окно входа Telegram. */
  const hrefOf = (p: Provider) =>
    p === 'steam' || (p === 'google' && config.auth.google)
      ? `/api/v1/auth/${p}?returnTo=${returnTo}`
      : undefined;

  /** Перед переходом: нужно согласие с офертой; неподключённый способ сообщает об этом. */
  const onProvider = (e: MouseEvent, p: Provider, name: string) => {
    if (!accepted) {
      e.preventDefault();
      return askConsent();
    }
    if (hrefOf(p)) return; // переход по ссылке
    e.preventDefault();
    if (p !== 'telegram' || !telegram) return toast.info(t('providerSoon', { provider: name }));
    const onUser = (user: TelegramUser | false) => {
      if (!user) return;
      void api
        .post('/auth/telegram', { ...user, intent: 'login' })
        .then(afterLogin)
        .catch((err: unknown) => toast.error(errorText(err)));
    };
    const options = { bot_id: telegram.botId, request_access: 'write' } as const;
    if (window.Telegram?.Login) return window.Telegram.Login.auth(options, onUser);
    void loadTelegram()
      .then((login) => login.auth(options, onUser))
      .catch(() => toast.error(t('telegramFailed')));
  };

  return (
    <Dialog.Root open={open} onOpenChange={(v) => (v ? undefined : close())}>
      <Dialog.Portal>
        <Dialog.Overlay className="gr-overlay fixed inset-0 z-50 bg-black/70 backdrop-blur-[2px]" />
        <Dialog.Content
          className="gr-dialog fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 outline-none"
          data-testid="login-modal"
        >
          <div className="max-h-[calc(100dvh-32px)] w-[622px] overflow-y-auto rounded-[36px] bg-surface-1 px-6 pb-6 pt-12 shadow-[0_24px_64px_rgb(0_0_0/0.6)] max-sm:[zoom:0.55] sm:max-md:[zoom:0.85]">
            <Dialog.Title className="text-center text-[36px] font-semibold">
              {t('title')}
            </Dialog.Title>
            <Dialog.Description className="sr-only">{t('subtitle')}</Dialog.Description>

            <label
              ref={consentRef}
              className="mt-12 flex cursor-pointer items-center justify-center gap-6"
              data-testid="login-offer"
            >
              <input
                type="checkbox"
                className="peer sr-only"
                checked={accepted}
                onChange={(e) => setAccepted(e.target.checked)}
              />
              <span
                className="relative h-6 w-9 shrink-0 rounded-[6px] bg-[#26262f] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent"
                aria-hidden="true"
              >
                <span
                  className={cn(
                    'absolute top-1 h-4 w-4 rounded-[2px] transition-[left,background-color] duration-150',
                    accepted ? 'left-4 bg-lime' : 'left-1 bg-[#3e3e50]',
                  )}
                />
              </span>
              <span className="whitespace-nowrap text-[24px] font-medium">
                {t.rich('offer', {
                  link: (chunks: ReactNode) => (
                    <Link
                      href="/legal/terms"
                      onClick={close}
                      className="text-lime underline decoration-1 underline-offset-[5px] hover:brightness-110"
                    >
                      {chunks}
                    </Link>
                  ),
                })}
              </span>
            </label>

            <div className="mt-12 flex flex-col gap-3">
              {PROVIDERS.map(({ key, name, Icon, iconClass, from }) => {
                const href = hrefOf(key);
                const props = {
                  onClick: (e: MouseEvent) => onProvider(e, key, name),
                  className:
                    'flex w-full items-center gap-6 rounded-[6px] p-6 text-left text-[24px] font-medium text-white transition hover:brightness-125',
                  style: { backgroundImage: `linear-gradient(90deg, ${from}, #181821)` },
                  'data-testid': `login-${key}`,
                };
                const content = (
                  <>
                    <Icon className={cn('shrink-0', iconClass)} />
                    {t(key)}
                  </>
                );
                return href ? (
                  <a key={key} href={href} {...props}>
                    {content}
                  </a>
                ) : (
                  <button key={key} type="button" {...props}>
                    {content}
                  </button>
                );
              })}
            </div>

            {config.auth.dev && (
              <div className="mt-6 rounded-[12px] bg-[#26262f] p-4">
                <div className="text-[16px] font-semibold text-warning">{t('devTitle')}</div>
                <p className="mt-2 text-[13px] text-dim">{t('devHint')}</p>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {(['player', 'support', 'admin'] as const).map((p) => (
                    <Button
                      key={p}
                      size="sm"
                      variant="outline"
                      loading={busy === p}
                      onClick={() => void devLogin(p)}
                      data-testid={`dev-login-${p}`}
                    >
                      {t(`devPreset.${p}`)}
                    </Button>
                  ))}
                </div>
                <form
                  className="mt-3 flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (nickname.trim().length >= 2) void devLogin('player', nickname.trim());
                  }}
                >
                  <Input
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                    placeholder={t('devNicknamePlaceholder')}
                    aria-label={t('devNickname')}
                    maxLength={24}
                    className="h-9"
                  />
                  <Button size="sm" type="submit" loading={busy === 'nick'} className="h-9">
                    {t('devSubmit')}
                  </Button>
                </form>
              </div>
            )}
            <Dialog.Close className="sr-only">{tc('close')}</Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
