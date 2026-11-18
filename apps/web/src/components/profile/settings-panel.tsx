'use client';

import type { MeDto } from '@gunraid/shared';
import { useQueryClient } from '@tanstack/react-query';
import { LogOut } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/checkbox';
import { Field, Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { ApiError, api } from '@/lib/api';
import { useConfig } from '@/lib/config';
import { useErrorMessage } from '@/lib/errors';
import { ME_KEY } from '@/lib/me';
import { reconnectSocket } from '@/lib/socket';
import { usePrefs } from '@/lib/store';

export function SettingsPanel({ me }: { me: MeDto }) {
  const t = useTranslations();
  const config = useConfig();
  const qc = useQueryClient();
  const router = useRouter();
  const errorText = useErrorMessage();
  const setSound = usePrefs((s) => s.setSound);
  const setFast = usePrefs((s) => s.setFast);
  const [nickname, setNickname] = useState(me.nickname);
  const [busy, setBusy] = useState<string | null>(null);

  const patch = async (key: string, body: Record<string, unknown>) => {
    setBusy(key);
    try {
      const updated = await api.patch<MeDto>('/me/settings', body);
      qc.setQueryData(ME_KEY, updated);
      return true;
    } catch (err) {
      toast.error(errorText(err));
      return false;
    } finally {
      setBusy(null);
    }
  };

  const logoutAll = async () => {
    setBusy('logoutAll');
    try {
      await api.post('/auth/logout-all');
      qc.setQueryData(ME_KEY, null);
      reconnectSocket();
      toast.success(t('auth.logoutAllDone'));
      router.push('/');
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="space-y-5 p-5">
        <form
          className="space-y-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await patch('nickname', { nickname })) toast.success(t('common.saved'));
          }}
        >
          <Field label={t('settings.nickname')} hint={t('settings.nicknameHint')} htmlFor="nickname">
            <div className="flex gap-2">
              <Input id="nickname" value={nickname} onChange={(e) => setNickname(e.target.value)} maxLength={24} />
              <Button type="submit" variant="secondary" loading={busy === 'nickname'} disabled={nickname.trim() === me.nickname}>
                {t('common.save')}
              </Button>
            </div>
          </Field>
        </form>

        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-semibold">{t('settings.sound')}</div>
            <div className="text-xs text-dim">{t('settings.soundHint')}</div>
          </div>
          <Switch
            id="sound"
            label={t('settings.sound')}
            checked={me.settings.soundEnabled}
            disabled={busy === 'sound'}
            onCheckedChange={(v) => {
              setSound(v);
              void patch('sound', { soundEnabled: v });
            }}
          />
        </div>
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-semibold">{t('settings.fastMode')}</div>
            <div className="text-xs text-dim">{t('settings.fastModeHint')}</div>
          </div>
          <Switch
            id="fast"
            label={t('settings.fastMode')}
            checked={me.settings.fastModeDefault}
            disabled={busy === 'fast'}
            onCheckedChange={(v) => {
              setFast(v);
              void patch('fast', { fastModeDefault: v });
            }}
          />
        </div>
      </Card>

      <Card className="space-y-5 p-5">
        {config.games.map((g) => (
          <GameProfileForm key={g.code} me={me} game={g.code} gameName={g.name} target={g.features.withdrawTarget} />
        ))}
        <div className="border-t border-line pt-5">
          <div className="mb-1 text-sm font-semibold">{t('settings.security')}</div>
          <p className="mb-3 text-xs text-dim">{t('settings.logoutAllHint')}</p>
          <Button variant="danger" loading={busy === 'logoutAll'} onClick={() => void logoutAll()}>
            <LogOut size={16} /> {t('settings.logoutAll')}
          </Button>
        </div>
      </Card>
    </div>
  );
}

function GameProfileForm({
  me,
  game,
  gameName,
  target,
}: {
  me: MeDto;
  game: string;
  gameName: string;
  target: 'trade_url' | 'player_id';
}) {
  const t = useTranslations();
  const qc = useQueryClient();
  const errorText = useErrorMessage();
  const current = me.gameProfiles[game];
  const initial = (target === 'trade_url' ? current?.tradeUrl : current?.playerId) ?? '';
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = target === 'trade_url' ? { tradeUrl: value.trim() || null } : { playerId: value.trim() || null };
      const updated = await api.put<MeDto>(`/me/games/${game}/profile`, body);
      qc.setQueryData(ME_KEY, updated);
      toast.success(t('common.saved'));
    } catch (err) {
      if (err instanceof ApiError) setError(errorText(err));
      else toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const id = `profile-${game}`;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <Field
        htmlFor={id}
        label={target === 'trade_url' ? t('settings.tradeUrl') : t('settings.playerId')}
        hint={target === 'trade_url' ? t('settings.tradeUrlHint') : t('settings.playerIdHint')}
        error={error}
      >
        <div className="flex gap-2">
          <Input
            id={id}
            value={value}
            invalid={Boolean(error)}
            inputMode={target === 'player_id' ? 'numeric' : 'url'}
            placeholder={target === 'trade_url' ? t('settings.tradeUrlPlaceholder') : t('settings.playerIdPlaceholder')}
            onChange={(e) => setValue(e.target.value)}
            aria-describedby={`${id}-game`}
          />
          <Button type="submit" variant="secondary" loading={busy} disabled={value.trim() === initial}>
            {t('common.save')}
          </Button>
        </div>
      </Field>
      <span id={`${id}-game`} className="sr-only">
        {t('settings.game', { game: gameName })}
      </span>
    </form>
  );
}
