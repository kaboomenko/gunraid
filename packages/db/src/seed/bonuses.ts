import { and, asc, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import { newId } from '../ids.js';
import {
  achievements,
  cases,
  games,
  items,
  leaderboards,
  levels,
  partners,
  promoCodes,
  wheelPrizes,
  type AchievementCondition,
  type LevelReward,
} from '../schema/index.js';

/** Порог XP уровня: 100 × (L − 1)^2,2 (1 XP = 1 гем ставки). */
export function xpForLevel(level: number): number {
  return level <= 1 ? 0 : Math.round(100 * (level - 1) ** 2.2);
}

export function rewardForLevel(level: number): LevelReward | null {
  if (level <= 1) return null;
  const reward: LevelReward = { balance: 5 * level };
  if (level % 5 === 0) reward.wheelSpins = 1;
  if (level % 10 === 0) reward.depositBonus = { percent: 0.1, maxAmount: 100 * level };
  return reward;
}

/** 50 уровней с наградами (правятся в админке). */
export async function seedLevels(db: Db): Promise<void> {
  const rows = Array.from({ length: 50 }, (_, i) => ({
    level: i + 1,
    xpRequired: xpForLevel(i + 1),
    reward: rewardForLevel(i + 1),
  }));
  await db.insert(levels).values(rows).onConflictDoNothing({ target: levels.level });
}

const ACHIEVEMENTS: Array<{
  code: string;
  name: string;
  description: string;
  icon: string;
  condition: AchievementCondition;
}> = [
  {
    code: 'first_case',
    name: 'Первый кейс',
    description: 'Откройте первый кейс',
    icon: 'box',
    condition: { type: 'cases_opened', target: 1 },
  },
  {
    code: 'cases_100',
    name: 'Коллекционер',
    description: 'Откройте 100 кейсов',
    icon: 'boxes',
    condition: { type: 'cases_opened', target: 100 },
  },
  {
    code: 'upgrade_win',
    name: 'Апгрейдер',
    description: 'Выиграйте апгрейд',
    icon: 'trending-up',
    condition: { type: 'upgrades_won', target: 1 },
  },
  {
    code: 'upgrade_risky',
    name: 'Ва-банк',
    description: 'Выиграйте апгрейд с шансом меньше 10 %',
    icon: 'zap',
    condition: { type: 'upgrade_win_below', target: 1, maxChance: 0.1 },
  },
  {
    code: 'contracts_10',
    name: 'Переплавщик',
    description: 'Подпишите 10 контрактов',
    icon: 'layers',
    condition: { type: 'contracts_done', target: 10 },
  },
  {
    code: 'battle_win',
    name: 'Первая победа',
    description: 'Выиграйте кейс-баттл',
    icon: 'swords',
    condition: { type: 'battles_won', target: 1 },
  },
  {
    code: 'battles_10',
    name: 'Гладиатор',
    description: 'Выиграйте 10 кейс-баттлов',
    icon: 'trophy',
    condition: { type: 'battles_won', target: 10 },
  },
  {
    code: 'big_drop',
    name: 'Крупный улов',
    description: 'Получите предмет дороже 10 000 гемов',
    icon: 'gem',
    condition: { type: 'best_drop', target: 10_000 },
  },
  {
    code: 'level_10',
    name: 'Ветеран',
    description: 'Достигните 10 уровня',
    icon: 'star',
    condition: { type: 'level', target: 10 },
  },
  {
    code: 'daily_7',
    name: 'Каждый день',
    description: 'Заберите ежедневный бонус 7 дней подряд',
    icon: 'calendar-check',
    condition: { type: 'daily_streak', target: 7 },
  },
  {
    code: 'first_deposit',
    name: 'Инвестор',
    description: 'Пополните баланс',
    icon: 'wallet',
    condition: { type: 'deposits', target: 1 },
  },
  {
    code: 'referral',
    name: 'Командир',
    description: 'Пригласите друга, который пополнит баланс',
    icon: 'users',
    condition: { type: 'referrals', target: 1 },
  },
];

export async function seedAchievements(db: Db): Promise<void> {
  await db
    .insert(achievements)
    .values(
      ACHIEVEMENTS.map((a, i) => ({
        id: newId(),
        code: a.code,
        name: { ru: a.name },
        description: { ru: a.description },
        icon: a.icon,
        condition: a.condition,
        sortOrder: i,
      })),
    )
    .onConflictDoNothing({ target: achievements.code });
}

/** Лидерборды за день и неделю по каждой игре (призы — в гемах, правятся в админке). */
export async function seedLeaderboards(db: Db): Promise<void> {
  const rows = await db.select({ id: games.id }).from(games);
  for (const g of rows) {
    await db
      .insert(leaderboards)
      .values([
        {
          id: newId(),
          gameId: g.id,
          period: 'day',
          prizes: [
            { from: 1, to: 1, amount: 500 },
            { from: 2, to: 2, amount: 300 },
            { from: 3, to: 3, amount: 200 },
            { from: 4, to: 10, amount: 50 },
          ],
        },
        {
          id: newId(),
          gameId: g.id,
          period: 'week',
          prizes: [
            { from: 1, to: 1, amount: 3000 },
            { from: 2, to: 2, amount: 1500 },
            { from: 3, to: 3, amount: 1000 },
            { from: 4, to: 10, amount: 250 },
          ],
        },
      ])
      .onConflictDoNothing();
  }
}

async function cheapestCase(db: Db, gameId: number) {
  const [c] = await db
    .select({ id: cases.id, name: cases.name })
    .from(cases)
    .where(
      and(
        eq(cases.gameId, gameId),
        eq(cases.kind, 'paid'),
        gt(cases.price, 0),
        isNull(cases.supplyTotal),
        isNull(cases.minLevel),
      ),
    )
    .orderBy(asc(cases.price))
    .limit(1);
  return c ?? null;
}

async function itemAround(db: Db, gameId: number, minPrice: number) {
  const [it] = await db
    .select({ id: items.id, skinName: items.skinName, fullName: items.fullName })
    .from(items)
    .where(
      and(eq(items.gameId, gameId), eq(items.isActive, true), sql`${items.price} >= ${minPrice}`),
    )
    .orderBy(asc(items.price))
    .limit(1);
  return it ?? null;
}

/** Демо-призы колеса для каждой игры (если призов ещё нет). */
export async function seedWheel(db: Db): Promise<void> {
  const rows = await db.select({ id: games.id }).from(games);
  for (const g of rows) {
    const [has] = await db
      .select({ id: wheelPrizes.id })
      .from(wheelPrizes)
      .where(eq(wheelPrizes.gameId, g.id))
      .limit(1);
    if (has) continue;
    const c = await cheapestCase(db, g.id);
    const item = await itemAround(db, g.id, 150);
    const gems = (amount: number, weight: number, color: string) => ({
      type: 'balance' as const,
      amount,
      weight,
      color,
      label: { ru: `${amount} гемов` },
    });
    const prizes = [
      gems(5, 300, '#2A2D36'),
      gems(10, 220, '#323642'),
      {
        type: 'deposit_bonus' as const,
        percent: 0.1,
        maxAmount: 1000,
        weight: 40,
        color: '#4FA8FF',
        label: { ru: '+10 % к пополнению' },
      },
      gems(25, 140, '#2A2D36'),
      ...(item
        ? [
            {
              type: 'item' as const,
              itemId: item.id,
              weight: 110,
              color: '#8B4DFF',
              label: { ru: item.skinName },
            },
          ]
        : []),
      gems(50, 80, '#323642'),
      { type: 'extra_spin' as const, weight: 16, color: '#FFB21E', label: { ru: 'Ещё вращение' } },
      ...(c
        ? [
            {
              type: 'free_case' as const,
              caseId: c.id,
              weight: 50,
              color: '#E03CC8',
              label: { ru: `Кейс «${c.name.ru ?? ''}»` },
            },
          ]
        : []),
      gems(100, 30, '#2A2D36'),
      gems(500, 4, '#C6FF00'),
    ];
    await db.insert(wheelPrizes).values(
      prizes.map((p, i) => ({
        id: newId(),
        gameId: g.id,
        sortOrder: i,
        ...p,
      })),
    );
  }
}

/**
 * Промокод с промо-полосы главной (+20% к депозиту). Отдельно от демо-набора:
 * добавляется и на уже заполненной базе; существующий код (в любом регистре) не трогаем.
 */
async function seedStripPromo(db: Db): Promise<void> {
  await db
    .insert(promoCodes)
    .values({
      id: newId(),
      code: 'RAID2027',
      type: 'deposit_bonus',
      percent: 0.2,
      maxAmount: 10_000,
      perUserLimit: 1,
      isActive: true,
    })
    .onConflictDoNothing();
}

/** Демо-промокоды и партнёр-блогер. */
export async function seedPromos(db: Db): Promise<void> {
  await seedStripPromo(db);
  const [has] = await db
    .select({ id: promoCodes.id })
    .from(promoCodes)
    .where(ne(promoCodes.code, 'RAID2027'))
    .limit(1);
  if (has) return;
  const partnerId = newId();
  await db
    .insert(partners)
    .values({ id: partnerId, name: 'Демо-блогер', note: 'Пример партнёра для промокодов' });
  const gameRows = await db.select({ id: games.id, code: games.code }).from(games);
  const cs2 = gameRows.find((g) => g.code === 'cs2');
  const so2 = gameRows.find((g) => g.code === 'standoff2');
  const cs2Case = cs2 ? await cheapestCase(db, cs2.id) : null;
  const so2Item = so2 ? await itemAround(db, so2.id, 100) : null;
  const base = { perUserLimit: 1, isActive: true };
  await db.insert(promoCodes).values([
    {
      id: newId(),
      code: 'GUNRAID',
      type: 'balance',
      amount: 100,
      totalLimit: 1000,
      partnerId,
      ...base,
    },
    {
      id: newId(),
      code: 'BONUS10',
      type: 'deposit_bonus',
      percent: 0.1,
      maxAmount: 2000,
      ...base,
    },
    { id: newId(), code: 'SPIN', type: 'wheel_spin', ...base },
    {
      id: newId(),
      code: 'NEWBIE',
      type: 'balance',
      amount: 50,
      newUsersMaxAgeHours: 72,
      ...base,
    },
    ...(cs2Case && cs2
      ? [
          {
            id: newId(),
            code: 'FREECASE',
            type: 'free_case' as const,
            caseId: cs2Case.id,
            gameId: cs2.id,
            ...base,
          },
        ]
      : []),
    ...(so2Item && so2
      ? [
          {
            id: newId(),
            code: 'SKINSO2',
            type: 'item' as const,
            itemId: so2Item.id,
            gameId: so2.id,
            ...base,
          },
        ]
      : []),
  ]);
}
