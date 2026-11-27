'use client';

import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { LoginIcon } from '@/components/icons/design-icons';
import { Skeleton } from '@/components/ui/skeleton';
import { useGameCode } from '@/lib/game';
import { useMe } from '@/lib/me';
import { useUi } from '@/lib/store';
import { BalancePill } from './balance';
import { MobileMenu } from './mobile-menu';

/**
 * Шапка телефона (< 768, макет 36.png): плашка #181821 высотой 60 (на 360 — 336×60) под рядом с лентой через 3,
 * углы 6 сверху и 18 снизу, поля 12. Слева логотип высотой 18 (зона нажатия 36); справа «Меню» и через 18 —
 * «Вход» 82×36 (лайм, скругление 6, поля 12, справа 16, иконка 12, DemiBold 12) или баланс и лаймовая «+» 36×36
 * через 3. Уже 320 (крупный системный шрифт) между «Меню» и кнопкой 12. Не липкая: часть верхнего блока, как на
 * десктопе; под ней через 12 начинается страница.
 */
export function PhoneHeader() {
  const t = useTranslations();
  const game = useGameCode();
  const me = useMe();
  const openLogin = useUi((s) => s.openLogin);
  const openDeposit = useUi((s) => s.openDeposit);

  return (
    <header className="px-3 pt-[3px] md:hidden">
      {/*
        Между логотипом и правой группой не меньше 12 (gap-3; обычно больше — ml-auto): зона нажатия «Меню» шире
        иконки на 12 влево и не заходит на ссылку логотипа. Не хватает места (280 и длинный баланс) — логотип
        пропорционально уменьшается (min-w-0 у ссылки, max-w-full у маски), а не вылезает правая группа.
      */}
      <div className="flex h-[60px] items-center gap-3 rounded-b-[18px] rounded-t-[6px] bg-surface-1 p-3">
        <Link
          href={`/${game}`}
          aria-label={t('brand.name')}
          className="-my-[9px] flex min-w-0 items-center py-[9px] text-lime"
        >
          <span className="logo-mask h-[18px] max-w-full" />
        </Link>
        <div className="ml-auto flex items-center gap-[18px] max-[320px]:gap-3">
          <MobileMenu me={me.data ?? null} />
          {me.isLoading ? (
            // Как «Вход»: у гостя ничего не сдвигается; без срезанных углов — кнопка скруглена.
            <Skeleton className="h-9 w-[82px] rounded-[6px] [clip-path:none]" />
          ) : me.data ? (
            <div className="flex items-center gap-[3px]">
              <BalancePill balance={me.data.balance} phone />
              <button
                type="button"
                className="grid size-9 shrink-0 place-items-center rounded-[6px] bg-lime text-accent-ink transition hover:brightness-110"
                onClick={openDeposit}
                aria-label={t('gems.deposit')}
                data-testid="deposit-open"
              >
                <Plus size={12} strokeWidth={3} />
              </button>
            </div>
          ) : (
            // min-w 82 — бокс Figma (81,17 → 82): без него кнопка уже на 0,83 и всё левее съезжает. Подпись — в
            // span: обрезка текста по прописным (text-box) действует на элемент, а не на голый текст во flex.
            <button
              type="button"
              className="flex h-9 min-w-[82px] shrink-0 items-center gap-3 rounded-[6px] bg-lime pl-3 pr-4 text-[12px] font-semibold text-accent-ink transition hover:brightness-110"
              onClick={openLogin}
              data-testid="login-button"
            >
              <LoginIcon size={12} className="shrink-0" />
              <span>{t('header.login')}</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
