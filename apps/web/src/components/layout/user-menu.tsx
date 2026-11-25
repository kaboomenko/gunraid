'use client';

import type { MeDto } from '@gunraid/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Backpack, Gift, LogOut, Settings, Shield, Trophy, User } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Avatar } from '@/components/ui/avatar';
import {
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownSeparator,
  DropdownTrigger,
} from '@/components/ui/dropdown';
import { toast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { useGameCode } from '@/lib/game';
import { ME_KEY } from '@/lib/me';
import { reconnectSocket } from '@/lib/socket';

export function UserMenu({ me, large }: { me: MeDto; large?: boolean }) {
  const t = useTranslations();
  const game = useGameCode();
  const qc = useQueryClient();
  const router = useRouter();

  const logout = async () => {
    await api.post('/auth/logout').catch(() => undefined);
    qc.setQueryData(ME_KEY, null);
    await qc.invalidateQueries();
    reconnectSocket();
    toast.info(t('auth.loggedOut'));
    router.refresh();
  };

  return (
    <Dropdown>
      <DropdownTrigger
        className="flex shrink-0 items-center gap-2"
        aria-label={t('header.profile')}
        data-testid="user-menu"
      >
        <Avatar
          src={me.avatarUrl}
          name={me.nickname}
          size="md"
          className={large ? 'h-[72px] w-[72px] text-[24px] [--cut:12px]' : undefined}
        />
      </DropdownTrigger>
      <DropdownContent align="end">
        <div className="flex items-center gap-3 px-3 pb-3 pt-2">
          <Avatar src={me.avatarUrl} name={me.nickname} size="md" />
          <div className="min-w-0">
            <div className="truncate font-semibold">{me.nickname}</div>
            <div className="text-xs text-dim">
              {t('header.level', { level: me.level })} · ID {me.shortId}
            </div>
          </div>
        </div>
        <DropdownSeparator />
        <DropdownItem asChild>
          <Link href={`/${game}/profile`}>
            <User size={16} /> {t('header.profile')}
          </Link>
        </DropdownItem>
        <DropdownItem asChild>
          <Link href={`/${game}/profile?tab=inventory`}>
            <Backpack size={16} /> {t('header.inventory')}
          </Link>
        </DropdownItem>
        <DropdownItem asChild>
          <Link href={`/${game}/bonuses`}>
            <Gift size={16} /> {t('nav.bonuses')}
          </Link>
        </DropdownItem>
        <DropdownItem asChild>
          <Link href={`/${game}/leaderboard`}>
            <Trophy size={16} /> {t('nav.leaderboard')}
          </Link>
        </DropdownItem>
        <DropdownItem asChild>
          <Link href={`/${game}/profile?tab=settings`}>
            <Settings size={16} /> {t('header.settings')}
          </Link>
        </DropdownItem>
        {(me.role === 'admin' || me.role === 'support') && (
          <DropdownItem asChild>
            <Link href="/admin">
              <Shield size={16} /> {t('header.admin')}
            </Link>
          </DropdownItem>
        )}
        <DropdownSeparator />
        <DropdownItem
          onSelect={() => void logout()}
          className="text-danger data-[highlighted]:text-danger"
        >
          <LogOut size={16} /> {t('header.logout')}
        </DropdownItem>
      </DropdownContent>
    </Dropdown>
  );
}
