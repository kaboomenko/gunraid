import type { CaseCategoryDto } from '@gunraid/shared';

export interface CaseNeighbour {
  slug: string;
  name: string;
  imageUrl: string | null;
}

export interface CaseNeighbours {
  prev: CaseNeighbour;
  next: CaseNeighbour;
}

/**
 * Соседние кейсы на странице кейса: порядок — как в каталоге на главной (категории по порядку,
 * кейсы внутри по порядку, без бесплатных — в сетке главной их тоже нет), по кругу: у первого
 * кейса слева последний. Кейса в этом списке нет (бесплатный, снятый с витрины) или он там
 * один — соседей и стрелок нет.
 */
export function caseNeighbours(
  categories: readonly CaseCategoryDto[],
  slug: string,
): CaseNeighbours | null {
  const list = categories.flatMap((c) => c.cases).filter((c) => c.kind !== 'free');
  const i = list.findIndex((c) => c.slug === slug);
  if (i < 0 || list.length < 2) return null;
  const at = (k: number): CaseNeighbour => {
    const c = list[(k + list.length) % list.length]!;
    return { slug: c.slug, name: c.name, imageUrl: c.imageUrl };
  };
  return { prev: at(i - 1), next: at(i + 1) };
}

/**
 * Шанс на карточке предмета (без знака %): точка как в макете («0.58»), два знака после точки;
 * у совсем редких предметов (меньше 0,01%) — две значащие цифры, чтобы не превращались в «0.00».
 */
export function formatChance(chance: string | number): string {
  const n = typeof chance === 'number' ? chance : Number(chance);
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 0.01) return n.toFixed(2);
  return String(Number(n.toPrecision(2)));
}
