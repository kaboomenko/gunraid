'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { GiftIcon } from '@/components/icons/design-icons';
import { ShapedButton } from '@/components/ui/shaped-button';
import { cn } from '@/lib/cn';
import { useConfig } from '@/lib/config';
import { useMe } from '@/lib/me';
import { useUi } from '@/lib/store';

/**
 * Баннер главной (макет): высота 750, скругление 36, текст в 140px от левого края, по центру
 * по вертикали, между элементами 48. Заголовок ExtraBold Italic 72 капслоком, подзаголовок
 * Medium Italic 36, кнопка — шаблон ×1.5 (460×108), иконка 36 + 24 + DemiBold 36,
 * #121117 на #B7FF00. Процент бонуса — из настроек (бонус к первому пополнению).
 * Кнопка: гостю — вход, вошедшему — бесплатный кейс (если есть), иначе пополнение.
 * На экранах шире макета картинка заполняет баннер по ширине и сдвинута вниз так, чтобы
 * голова солдата оставалась в кадре (обрезается низ, а не верх).
 * Телефон (< 768, макет 360): высота 150, скругление 18, содержимое в 24 от краёв, по центру по вертикали,
 * между элементами 12. Заголовок ExtraBold Italic 16 с тенью — подложки нет, как в макете; подзаголовок —
 * только для экранных читалок: в 12 px он ложится на солдата. Кнопка — шаблон ×0.5 (36): иконка 12 + 12 +
 * DemiBold 12, поля 12 / 16. Картинка — cover, 50% 15%: верх баннера как в макете 36.png, шлем в кадре до 767.
 * Заголовок не шире 200 (на 360 плечо солдата — в ≈ 230 от края баннера): строки с процентом (до 190 у «+100%»)
 * остаются в 2 строки, а без процента «сразу после регистрации» (262) переносится в 3 и не ложится на солдата.
 * Баннер уже 374 картинка вписана по высоте (374×150) и обрезается с боков: при 50% чем уже окно, тем левее
 * солдат — на окнах уже 360 заголовок ложился на винтовку и плечо. Уже 360 и при бонусе 0% (первая из трёх строк —
 * на высоте ствола) картинка прижата к левому краю, 0% 15%: дуло — в 215 от края баннера, от букв до солдата не
 * меньше 13. На 360 и шире при проценте вид прежний (сверен с 36.png); от 398 картинка вписана по ширине — 0% и 50%
 * совпадают.
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
      className="relative isolate h-[150px] overflow-hidden rounded-[18px] bg-[#25304a] md:h-[520px] md:rounded-[36px] xl:h-[750px]"
      data-testid="bonus-banner"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/design/hero-bonus.webp"
        alt=""
        width={1872}
        height={750}
        className={cn(
          'absolute inset-0 -z-10 h-full w-full object-cover md:object-[70%_center] xl:object-[right_20%]',
          percent > 0 ? 'object-[50%_15%] max-[360px]:object-[0%_15%]' : 'object-[0%_15%]',
        )}
        draggable={false}
        fetchPriority="high"
      />
      {/* Планшет (768–1279): текст ложится на солдата — подложка для читаемости. На телефоне и десктопе её нет (как в макете). */}
      <div
        className="absolute inset-0 -z-10 hidden bg-[linear-gradient(90deg,rgb(18_17_23/0.8),rgb(18_17_23/0.35)_60%,transparent)] md:block xl:hidden"
        aria-hidden="true"
      />
      <div className="flex h-full max-w-full flex-col items-start justify-center gap-3 px-6 md:gap-8 md:pl-16 xl:gap-12 xl:pl-[140px]">
        <h1 className="text-[16px] font-extrabold uppercase italic max-md:max-w-[200px] max-md:[text-shadow:0_1px_8px_rgb(18_17_23/0.6)] md:text-[48px] xl:text-[72px]">
          {percent > 0 ? t.rich('title', { percent, br }) : t.rich('titleNoDeposit', { br })}
        </h1>
        <p className="text-[16px] font-medium italic max-md:sr-only md:text-[24px] xl:text-[36px]">
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
          className="hidden gap-3 bg-lime text-[20px] text-accent-ink hover:bg-lime hover:brightness-110 md:inline-flex xl:hidden"
          onClick={claim}
        >
          <GiftIcon size={24} />
          {t('cta')}
        </ShapedButton>
        {/*
          Телефон: шаблон ×0.5 — высота 36 (иконка 12 и по 12 сверху и снизу), поля 12 / 16, как у «Вход». Подпись — в
          span: обрезка по прописным действует на элемент, а не на голый текст во flex. Кнопка обрезана по форме
          (clip-path) — рамка фокуса внутрь и тёмная: лаймовая на лаймовой кнопке не видна.
        */}
        <ShapedButton
          variant="lime"
          height={36}
          className="gap-3 bg-lime pl-3 pr-4 text-[12px] text-accent-ink hover:bg-lime hover:brightness-110 focus-visible:outline-offset-[-4px] focus-visible:outline-accent-ink md:hidden"
          onClick={claim}
        >
          <GiftIcon size={12} className="shrink-0" />
          <span>{t('cta')}</span>
        </ShapedButton>
      </div>
    </section>
  );
}
