'use client';

import { useTranslations } from 'next-intl';
import { ShapedButton, shapeHeight } from '@/components/ui/shaped-button';
import { toast } from '@/components/ui/toast';
import { useConfig } from '@/lib/config';
import { useMe } from '@/lib/me';
import { useUi } from '@/lib/store';

/**
 * Промо-полоса над лентой дропов (макет: высота 127, скругление 24).
 * Текст — Bold Italic 36 капителью, через 72px — промокод DemiBold 36 в кнопке «лайм 20% + размытие».
 * Код и процент меняются в админке (настройка promoStrip).
 */
export function PromoStrip() {
  const t = useTranslations('promoStrip');
  const promo = useConfig().promoStrip;
  const me = useMe();
  const openDeposit = useUi((s) => s.openDeposit);
  const openLogin = useUi((s) => s.openLogin);
  if (!promo) return null;

  const apply = () => {
    if (me.data) {
      openDeposit(promo.code);
      return;
    }
    void navigator.clipboard?.writeText(promo.code).then(
      () => toast.info(t('copied', { code: promo.code })),
      () => undefined,
    );
    openLogin();
  };

  return (
    <section
      className="promo-strip flex h-[88px] items-center justify-center gap-3 rounded-[16px] px-3 md:h-[127px] md:gap-[72px] md:rounded-[24px]"
      aria-label={t('label', { code: promo.code, percent: promo.bonusPercent })}
      data-testid="promo-strip"
    >
      <div className="promo-flakes" aria-hidden="true" />
      <p className="text-center text-[16px] font-bold italic [font-variant-caps:all-small-caps] md:text-[36px]">
        {t.rich('title', { percent: promo.bonusPercent, br: () => <br /> })}
      </p>
      <ShapedButton
        variant="glass"
        height={shapeHeight({ fontSize: 36 })}
        className="hidden min-w-[307px] text-[36px] md:inline-flex"
        onClick={apply}
        title={t('apply')}
        data-testid="promo-strip-code"
      >
        {promo.code}
      </ShapedButton>
      <ShapedButton
        variant="glass"
        height={shapeHeight({ fontSize: 16 })}
        className="text-[16px] md:hidden"
        onClick={apply}
        title={t('apply')}
      >
        {promo.code}
      </ShapedButton>
    </section>
  );
}
