import { ADRENALINE_LEVELS, type AdrenalineLevel, type CaseCardDto } from '@gunraid/shared';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { CSSProperties } from 'react';
import { GemIcon } from '@/components/icons/design-icons';
import { cn } from '@/lib/cn';

/** Цвета шагов уровня адреналина (макет). */
const LEVEL_COLORS: Record<AdrenalineLevel, string> = {
  low: '#0DFF8A',
  normal: '#FFD900',
  high: '#FF5D00',
  extreme: '#FF0000',
};

/**
 * Уровень адреналина: четыре шага, уровень кейса — 100%, остальные — 30% (стили — .adrenaline-bar).
 * В карточке на телефоне — 130×7, шаги 30×3.
 */
export function AdrenalineBar({
  level,
  className,
}: {
  level: AdrenalineLevel;
  className?: string;
}) {
  const t = useTranslations('home.filters');
  return (
    <span
      role="img"
      aria-label={`${t('adrenaline')}: ${t(`levels.${level}`)}`}
      className={cn('adrenaline-bar', className)}
      data-level={level}
    >
      {ADRENALINE_LEVELS.map((l) => (
        <span
          key={l}
          className="adrenaline-bar__step"
          style={{ '--step': LEVEL_COLORS[l] } as CSSProperties}
          data-active={l === level ? '' : undefined}
        />
      ))}
    </span>
  );
}

/**
 * Карточка кейса на главной (макет): 317×317, картинка на всю карточку, название сверху,
 * уровень адреналина снизу, над ним в 12px — плашка с ценой. Стили — .case-tile в globals.css.
 * Телефон (< 768): 144×144 — название DemiBold 12, плашка 24, шкала 130×7 (globals.css).
 */
export function CaseTile({ game, c }: { game: string; c: CaseCardDto }) {
  const t = useTranslations('case');
  const tg = useTranslations('gems');
  const notes = [
    c.supplyTotal !== null
      ? t('supply', { left: c.supplyTotal - c.supplyUsed, total: c.supplyTotal })
      : null,
    c.minLevel ? t('fromLevel', { level: c.minLevel }) : null,
    c.cooldownSeconds ? t('everyHours', { hours: Math.round(c.cooldownSeconds / 3600) }) : null,
  ].filter(Boolean);

  return (
    <Link
      href={`/${game}/case/${c.slug}`}
      className="case-tile"
      data-testid={`case-card-${c.slug}`}
    >
      {c.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={c.imageUrl}
          alt=""
          width={317}
          height={317}
          loading="lazy"
          draggable={false}
          className="case-tile__image"
        />
      ) : null}
      <span className="case-tile__name truncate">{c.name}</span>
      {notes.length ? <span className="case-tile__note truncate">{notes.join(' · ')}</span> : null}
      <span className="case-tile__price shape">
        {/* Текст — в <span>: голый текст во flex-контейнере не получает обрезку по прописным
            и встаёт выше центра плашки. Цифры читаются вслух с единицей: «49 гемов». */}
        {c.kind === 'free' ? (
          <span>{t('free')}</span>
        ) : (
          <>
            <GemIcon className="case-tile__gem" />
            <span aria-hidden="true">{c.price}</span>
            <span className="sr-only">{tg('amount', { count: c.price })}</span>
          </>
        )}
      </span>
      <AdrenalineBar level={c.adrenaline} className="case-tile__bar" />
    </Link>
  );
}
