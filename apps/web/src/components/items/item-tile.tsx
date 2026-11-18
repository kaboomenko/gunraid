import type { ItemDto } from '@gunraid/shared';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { ItemCard } from '@/components/ui/item-card';

/** Бейджи предмета: StatTrak, Souvenir, износ. */
export function ItemBadges({ item, stLabel, svLabel }: { item: ItemDto; stLabel: string; svLabel: string }) {
  const out: ReactNode[] = [];
  if (item.isStattrak) out.push(<Badge key="st" tone="warning">{stLabel}</Badge>);
  if (item.isSouvenir) out.push(<Badge key="sv" tone="info">{svLabel}</Badge>);
  if (item.wear) out.push(<Badge key="w">{item.wear}</Badge>);
  return out.length ? <>{out}</> : null;
}

export function ItemTile({
  item,
  stLabel,
  svLabel,
  footer,
  onClick,
  selected,
  dimmed,
  size,
}: {
  item: ItemDto;
  stLabel: string;
  svLabel: string;
  footer?: ReactNode;
  onClick?: () => void;
  selected?: boolean;
  dimmed?: boolean;
  size?: 'sm' | 'md';
}) {
  return (
    <ItemCard
      name={item.modelName ?? item.fullName}
      skin={item.skinName}
      imageUrl={item.imageUrl}
      rarityColor={item.rarity.color}
      rarityName={item.modelName ?? item.rarity.name}
      price={item.price}
      badges={<ItemBadges item={item} stLabel={stLabel} svLabel={svLabel} />}
      footer={footer}
      onClick={onClick}
      selected={selected}
      dimmed={dimmed}
      size={size}
    />
  );
}
