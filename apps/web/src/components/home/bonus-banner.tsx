'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { GiftIcon } from '@/components/icons/design-icons';
import { ShapedButton } from '@/components/ui/shaped-button';
import { useConfig } from '@/lib/config';
import { useMe } from '@/lib/me';
import { useUi } from '@/lib/store';

/**
 * Баннер главной (макет): высота 750, скругление 36, текст в 140px от левого края, по центру
 * по вертикали, между элементами 48. Заголовок ExtraBold Italic 72 капслоком, подзаголовок
 * Medium Italic 36, кнопка — шаблон ×1.5 (460×108), иконка 36 + 24 + DemiBold 36,
 * #121117 на #B7FF00. Процент бонуса — из настроек (бонус к первому пополнению).
 * Кнопка: гостю — вход, вошедшему — бесплатный кейс (если есть), иначе пополнение.
 */
export function BonusBanner({ game, freeCaseSlug }: { game: string; freeCaseSlug: string | null }) {
  const t = useTranslations('home.bonusBanner');
  const percent = useConfig().firstDepositPercent;
  const me = useMe();
  const router = useRouter();
  const openLogin = useUi((s) => s.openLogin);
  const openDeposit = useUi((s) => s.openDeposit);
  const br = () => <br />;

  const claim = () => {
    if (!me.data) openLogin();
    else if (freeCaseSlug) router.push(`/${game}/case/${freeCaseSlug}`);
    else openDeposit();
  };

  return (
    <section
      className="relative isolate h-[360px] overflow-hidden rounded-[24px] bg-[#25304a] md:h-[520px] md:rounded-[36px] xl:h-[750px]"
      data-testid="bonus-banner"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/design/hero-bonus.webp"
        alt=""
        className="absolute inset-0 -z-10 h-full w-full object-cover object-[70%_center] xl:object-[right_center]"
        draggable={false}
        fetchPriority="high"
      />
      {/* На узких экранах текст ложится на солдата — подложка для читаемости (на десктопе как в макете). */}
      <div
        className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,rgb(18_17_23/0.8),rgb(18_17_23/0.35)_60%,transparent)] xl:hidden"
        aria-hidden="true"
      />
      <div className="flex h-full max-w-full flex-col items-start justify-center gap-6 px-6 md:gap-8 md:pl-16 xl:gap-12 xl:pl-[140px]">
        <h1 className="text-[28px] font-extrabold uppercase italic md:text-[48px] xl:text-[72px]">
          {percent > 0 ? t.rich('title', { percent, br }) : t.rich('titleNoDeposit', { br })}
        </h1>
        <p className="text-[16px] font-medium italic md:text-[24px] xl:text-[36px]">
          {percent > 0 ? t.rich('text', { percent, br }) : t.rich('textNoDeposit', { br })}
        </p>
        <ShapedButton
          variant="lime"
          height={108}
          className="hidden w-[460px] gap-6 bg-lime text-[36px] text-accent-ink hover:bg-lime hover:brightness-110 xl:inline-flex"
          onClick={claim}
          data-testid="bonus-banner-cta"
        >
          <GiftIcon size={36} />
          {t('cta')}
        </ShapedButton>
        <ShapedButton
          variant="lime"
          height={64}
          className="gap-3 bg-lime text-[20px] text-accent-ink hover:bg-lime hover:brightness-110 xl:hidden"
          onClick={claim}
        >
          <GiftIcon size={24} />
          {t('cta')}
        </ShapedButton>
      </div>
    </section>
  );
}
