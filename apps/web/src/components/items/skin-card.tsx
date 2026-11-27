import { formatGems, type ItemDto } from '@gunraid/shared';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { CSSProperties } from 'react';
import { GemIcon } from '@/components/icons/design-icons';
import { formatChance } from '@/lib/case-page';
import { cn } from '@/lib/cn';

/** Тип оружия для карточки: «M9 Bayonet»; у StatTrak™ и сувенирных — с пометкой, чтобы их можно было отличить. */
function weaponLine(item: ItemDto): string {
  const model = item.modelName ?? item.fullName.split(' | ')[0] ?? item.fullName;
  if (item.isStattrak) return `StatTrak™ ${model.replace(/^★\s*/, '')}`;
  if (item.isSouvenir) return `Souvenir ${model}`;
  return model;
}

export interface SkinCardProps {
  item: ItemDto;
  /** Шанс выпадения в процентах (строка из API); без него блок «Шанс» не показывается. */
  chance?: string | null;
  /** Ссылка на страницу предмета; без неё карточка — просто картинка (лента рулетки). */
  href?: string;
  /** Картинку грузить сразу (лента рулетки: lazy-загрузка в движущейся ленте опаздывает). */
  eager?: boolean;
  className?: string;
  'data-testid'?: string;
}

/**
 * Карточка предмета 286×185 (макет «содержимое кейса», та же — в ленте рулетки): фон #181821,
 * скругление 12, свечение цвета редкости и мазки drop-styled-bg — как у карточки дропа в ленте (мазки —
 * своего размера, 330×213 со сдвигом −9, −5, как в макете этой карточки).
 * Картинка скина — рамка 230×115 в 20px от верха по центру (сам скин, как в макете, — во внутреннем
 * поле 170×85); слева снизу в 18px от краёв — тип оружия (Regular 18, белый 50%), название скина
 * (Medium 18) и цена (гем 12×18 + 6 + DemiBold 18 #B7FF00 — по тексту спецификации), строки через 6; справа
 * сверху в 18px — «Шанс» (Regular 18, белый 50%) и шанс (Medium 18); внизу по центру — полоса
 * редкости 176×2. Всё задано в долях ширины карточки (стили — .skin-card в globals.css); совсем
 * маленькая карточка в дорожках рулетки (x5 на планшете) — без текста. На телефоне (< 768) свои
 * размеры задают модификаторы: skin-card--reel — 90×60 в дропленте, skin-card--m — 108×72 в содержимом
 * кейса, окне результата и у груза (тексты 8, гем 8; уже 360 карточка меньше, тексты — нет; className).
 * id предмета — в data-item-id: по нему e2e сверяет, что под меткой стоит выигрыш из ответа сервера.
 */
export function SkinCard({
  item,
  chance,
  href,
  eager,
  className,
  'data-testid': testId,
}: SkinCardProps) {
  const t = useTranslations();
  const weapon = weaponLine(item);
  const style = { '--rc': item.rarity.color } as CSSProperties;
  const body = (
    <span className="skin-card__body">
      <span className="skin-card__glow-a" aria-hidden="true" />
      <span className="skin-card__glow-b" aria-hidden="true" />
      <span className="skin-card__brush" aria-hidden="true" />
      {item.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.imageUrl}
          alt=""
          className="skin-card__image"
          loading={eager ? 'eager' : 'lazy'}
          draggable={false}
        />
      ) : null}
      {chance != null && chance !== '' ? (
        <span className="skin-card__chance">
          <span className="skin-card__muted">{t('case.chanceLabel')}</span>
          <span className="skin-card__chance-value" data-testid="skin-card-chance">
            {t('case.chance', { chance: formatChance(chance) })}
          </span>
        </span>
      ) : null}
      <span className="skin-card__info">
        <span className="skin-card__muted truncate" data-testid="skin-card-weapon">
          {weapon}
        </span>
        <span className="skin-card__skin truncate" data-testid="skin-card-skin">
          {item.skinName}
        </span>
        <span className="skin-card__price" data-testid="skin-card-price">
          <GemIcon className="skin-card__gem" />
          {/* Число — в <span>: голый текст во flex-контейнере не обрезается по прописным. */}
          <span aria-hidden="true" data-testid="skin-card-price-value">
            {formatGems(item.price)}
          </span>
          <span className="sr-only">{t('gems.amount', { count: item.price })}</span>
        </span>
      </span>
      <span className="skin-card__bar" aria-hidden="true" />
    </span>
  );
  const title = `${weapon} | ${item.skinName}`;
  return href ? (
    <Link
      href={href}
      className={cn('skin-card', className)}
      style={style}
      title={title}
      data-testid={testId}
      data-item-id={item.id}
    >
      {body}
    </Link>
  ) : (
    <div
      className={cn('skin-card', className)}
      style={style}
      data-testid={testId}
      data-item-id={item.id}
    >
      {body}
    </div>
  );
}
