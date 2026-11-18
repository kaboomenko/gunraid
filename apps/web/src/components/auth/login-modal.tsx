'use client';

import type { DevLoginPreset } from '@gunraid/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Gamepad2, Send } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { toast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { useConfig } from '@/lib/config';
import { useErrorMessage } from '@/lib/errors';
import { ME_KEY } from '@/lib/me';
import { reconnectSocket } from '@/lib/socket';
import { TelegramWidget } from './telegram-widget';
import { useUi } from '@/lib/store';

function GoogleMark() {
  return (
    <span className="grid h-5 w-5 place-items-center rounded-full bg-white text-[13px] font-black text-[#4285F4]" aria-hidden="true">
      G
    </span>
  );
}

export function LoginModal() {
  const t = useTranslations('auth');
  const open = useUi((s) => s.loginOpen);
  const close = useUi((s) => s.closeLogin);
  const config = useConfig();
  const pathname = usePathname();
  const qc = useQueryClient();
  const errorText = useErrorMessage();
  const [busy, setBusy] = useState<string | null>(null);
  const [nickname, setNickname] = useState('');

  const returnTo = encodeURIComponent(pathname || '/');

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


  return (
    <Modal open={open} onOpenChange={(v) => (v ? undefined : close())} title={t('title')} description={t('subtitle')}>
      <div className="flex flex-col gap-3">
        {config.auth.steam && (
          <Button asChild variant="secondary" size="lg" block>
            <a href={`/api/v1/auth/steam?returnTo=${returnTo}`} data-testid="login-steam">
              <Gamepad2 size={20} /> {t('steam')}
            </a>
          </Button>
        )}
        {config.auth.google && (
          <Button asChild variant="secondary" size="lg" block>
            <a href={`/api/v1/auth/google?returnTo=${returnTo}`}>
              <GoogleMark /> {t('google')}
            </a>
          </Button>
        )}
        {config.auth.telegram && open && (
          <div className="flex min-h-12 items-center justify-center gap-2">
            <Send size={18} className="text-info" />
            <TelegramWidget
              intent="login"
              onAuth={(payload) =>
                void api
                  .post('/auth/telegram', payload)
                  .then(afterLogin)
                  .catch((err: unknown) => toast.error(errorText(err)))
              }
            />
          </div>
        )}

        {config.auth.dev && (
          <div className="cut mt-2 p-4 [--cut-bg:var(--color-surface-2)] [--cut-border:rgb(255_178_30/0.4)]">
            <div className="font-display text-sm font-bold uppercase tracking-wide text-warning">{t('devTitle')}</div>
            <p className="mb-3 text-xs text-dim">{t('devHint')}</p>
            <div className="grid grid-cols-3 gap-2">
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

        <p className="mt-1 text-center text-xs leading-relaxed text-dim">
          {t.rich('terms', {
            rules: (chunks) => (
              <Link href="/legal/rules" className="text-muted underline underline-offset-2" onClick={close}>
                {chunks}
              </Link>
            ),
            terms: (chunks) => (
              <Link href="/legal/terms" className="text-muted underline underline-offset-2" onClick={close}>
                {chunks}
              </Link>
            ),
          })}
        </p>
      </div>
    </Modal>
  );
}
