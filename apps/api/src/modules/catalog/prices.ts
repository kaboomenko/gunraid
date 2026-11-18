import { Inject, Injectable, Logger } from '@nestjs/common';
import { itemPriceHistory, items, type Db } from '@gunraid/db';
import { usdToGemsRounded } from '@gunraid/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { DB } from '../../core/tokens.js';
import type { GameRow } from '../games/games.service.js';
import { SettingsService } from '../settings/settings.service.js';

export interface PriceQuote {
  marketName: string;
  /** Цена в долларах (десятичная строка) или уже в гемах. */
  price: { amount: string; currency: 'USD' | 'GEMS' };
}

/**
 * Источник цен. Сейчас — заглушка, читающая цены из БД (CSV-импорт обновляет их напрямую).
 * Позже: реализация с загрузкой цен с маркетов — регистрируется в PRICE_PROVIDER без правок вызывающего кода.
 */
export interface PriceProvider {
  readonly code: string;
  fetchPrices(game: GameRow): Promise<PriceQuote[]>;
}

export const PRICE_PROVIDER = Symbol('PRICE_PROVIDER');

@Injectable()
export class DbPriceProvider implements PriceProvider {
  readonly code = 'db';

  constructor(@Inject(DB) private readonly db: Db) {}

  /** Заглушка: возвращает текущие цены из БД — то есть изменений нет. */
  async fetchPrices(game: GameRow): Promise<PriceQuote[]> {
    const rows = await this.db
      .select({ marketName: items.marketName, price: items.price })
      .from(items)
      .where(eq(items.gameId, game.id));
    return rows.map((r) => ({ marketName: r.marketName, price: { amount: String(r.price), currency: 'GEMS' } }));
  }
}

@Injectable()
export class PricesService {
  private readonly logger = new Logger(PricesService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(PRICE_PROVIDER) private readonly provider: PriceProvider,
    private readonly settings: SettingsService,
  ) {}

  /** Применяет котировки: обновляет изменившиеся цены и пишет историю. */
  async apply(game: GameRow, quotes: PriceQuote[], source: string, actorId: string | null = null): Promise<number> {
    if (!quotes.length) return 0;
    const { gemsPerUsd } = await this.settings.get('currency');
    const byName = new Map(quotes.map((q) => [q.marketName, q]));
    const rows = await this.db
      .select({ id: items.id, marketName: items.marketName, price: items.price })
      .from(items)
      .where(and(eq(items.gameId, game.id), inArray(items.marketName, [...byName.keys()])));
    let changed = 0;
    for (const row of rows) {
      const q = byName.get(row.marketName);
      if (!q) continue;
      const gems =
        q.price.currency === 'USD' ? usdToGemsRounded(q.price.amount, gemsPerUsd) : Number(q.price.amount);
      if (!Number.isSafeInteger(gems) || gems < 0 || gems === row.price) continue;
      await this.db.transaction(async (tx) => {
        await tx.update(items).set({ price: gems, priceUpdatedAt: sql`now()`, updatedAt: sql`now()` }).where(eq(items.id, row.id));
        await tx.insert(itemPriceHistory).values({
          itemId: row.id,
          price: gems,
          sourcePrice: q.price.currency === 'USD' ? q.price.amount : null,
          sourceCurrency: q.price.currency === 'USD' ? 'USD' : null,
          source,
          actorId,
        });
      });
      changed += 1;
    }
    return changed;
  }

  /** Плановое обновление цен из провайдера (воркер). */
  async refresh(game: GameRow): Promise<number> {
    const quotes = await this.provider.fetchPrices(game);
    const changed = await this.apply(game, quotes, `provider:${this.provider.code}`);
    if (changed) this.logger.log(`${game.code}: ${changed} prices updated by ${this.provider.code}`);
    return changed;
  }
}
