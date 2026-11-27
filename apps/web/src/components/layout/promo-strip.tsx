'use client';

import { useTranslations } from 'next-intl';
import { ShapedButton, shapeHeight } from '@/components/ui/shaped-button';
import { toast } from '@/components/ui/toast';
import { useConfig } from '@/lib/config';
import { useMe } from '@/lib/me';
import { useUi } from '@/lib/store';
import { PromoDrift } from './promo-drift';
import { PromoSnow } from './promo-snow';

/**
 * Промо-полоса над лентой дропов (макет: высота 127; верхние углы — внешние углы верхнего блока, 36,
 * нижние касаются ряда с лентой — 12).
 * Текст — Bold Italic 36 капителью, через 72px — промокод DemiBold 36 в кнопке «лайм 20% + размытие».
 * Телефон (< 768, макет 36.png): высота 60, углы 18 сверху и 6 снизу, текст Bold Italic 12 в две строки,
 * через 24 — кнопка 102,33×24 (десктопная ÷ 3), промокод DemiBold 12; группа по центру полосы.
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
      className="promo-strip flex h-[60px] items-center justify-center gap-6 rounded-b-[6px] rounded-t-[18px] px-3 md:h-[127px] md:gap-[72px] md:rounded-b-[12px] md:rounded-t-[36px]"
      aria-label={t('label', { code: promo.code, percent: promo.bonusPercent })}
      data-testid="promo-strip"
    >
      <PromoDrift />
      <PromoSnow />
      <p
        data-drift-avoid="lines"
        className="text-center text-[12px] font-bold italic [font-variant-caps:all-small-caps] md:text-[36px]"
      >
        {t.rich('title', { percent: promo.bonusPercent, br: () => <br /> })}
      </p>
      <ShapedButton
        variant="glass"
        height={shapeHeight({ fontSize: 36 })}
        className="hidden min-w-[307px] text-[36px] md:inline-flex"
        onClick={apply}
        title={t('apply')}
        data-testid="promo-strip-code"
        data-drift-avoid=""
      >
        {promo.code}
      </ShapedButton>
      {/*
       * Телефон: десктопная кнопка ÷ 3 — 102,33×24, поля 8, размытие фона 2px (десктопные 6px ÷ 3). Высота
       * задана явно: shapeHeight({ fontSize: 12 }) дал бы 56,4. Кнопка обрезана по форме (clip-path) —
       * рамка фокуса внутрь.
       */}
      <ShapedButton
        variant="glass"
        height={24}
        className="min-w-[102.33px] px-2 text-[12px] backdrop-blur-[2px] focus-visible:outline-offset-[-2px] md:hidden"
        onClick={apply}
        title={t('apply')}
        data-drift-avoid=""
      >
        {/* код — своим блоком: обрезанный по прописным (trim), он встаёт по центру кнопки, как в макете */}
        <span>{promo.code}</span>
      </ShapedButton>
    </section>
  );
}
