import { Inject, Injectable } from '@nestjs/common';
import {
  catalogImports,
  collections,
  itemModels,
  itemPriceHistory,
  itemTypes,
  items,
  newId,
  rarities,
  type Db,
} from '@gunraid/db';
import { ITEM_WEARS, usdToGemsRounded, type ItemWear } from '@gunraid/shared';
import { and, eq, sql } from 'drizzle-orm';
import { DB } from '../../core/tokens.js';
import { AppError } from '../../common/app-error.js';
import { AuditService } from '../audit/audit.service.js';
import type { GameRow } from '../games/games.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { parseCsv } from './csv.js';

export const CSV_COLUMNS = [
  'market_name',
  'full_name',
  'skin_name',
  'type',
  'model',
  'rarity',
  'collection',
  'image_url',
  'price_gems',
  'price_usd',
  'stattrak',
  'souvenir',
  'wear',
  'float_min',
  'float_max',
  'withdrawable',
  'active',
] as const;

export interface CsvImportResult {
  importId: string;
  created: number;
  updated: number;
  skipped: number;
  errors: Array<{ line: number; message: string }>;
}

const truthy = (v: string | undefined, fallback: boolean) =>
  v === undefined || v.trim() === '' ? fallback : ['1', 'true', 'yes', 'да', 'y'].includes(v.trim().toLowerCase());

/** CSV-импорт каталога и цен (админка). Строки сопоставляются по (игра, market_name). */
@Injectable()
export class CsvImportService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  async import(game: GameRow, fileName: string, csvText: string, actorId: string): Promise<CsvImportResult> {
    const rows = parseCsv(csvText);
    if (rows.length < 2) throw new AppError('CSV_INVALID', 400, { reason: 'empty' });
    const header = (rows[0] ?? []).map((h) => h.trim().toLowerCase());
    const col = (name: string) => header.indexOf(name);
    for (const required of ['market_name', 'rarity']) {
      if (col(required) < 0) throw new AppError('CSV_INVALID', 400, { reason: `missing column ${required}` });
    }
    if (col('price_gems') < 0 && col('price_usd') < 0) {
      throw new AppError('CSV_INVALID', 400, { reason: 'missing column price_gems or price_usd' });
    }

    const importId = newId();
    await this.db.insert(catalogImports).values({ id: importId, gameId: game.id, actorId, fileName });
    const { gemsPerUsd } = await this.settings.get('currency');
    const rarityMap = new Map(
      (await this.db.select().from(rarities).where(eq(rarities.gameId, game.id))).map((r) => [r.code, r.id]),
    );
    const typeMap = new Map((await this.db.select().from(itemTypes)).map((t) => [t.code, t.id]));
    const result: CsvImportResult = { importId, created: 0, updated: 0, skipped: 0, errors: [] };

    for (let i = 1; i < rows.length; i++) {
      const line = i + 1;
      const r = rows[i] ?? [];
      const get = (name: string) => {
        const idx = col(name);
        return idx >= 0 ? (r[idx] ?? '').trim() : undefined;
      };
      try {
        const marketName = get('market_name');
        if (!marketName) throw new Error('market_name is empty');
        const rarityId = rarityMap.get(get('rarity') ?? '');
        if (!rarityId) throw new Error(`unknown rarity "${get('rarity')}"`);
        const typeCode = get('type') || 'weapon';
        const typeId = typeMap.get(typeCode);
        if (!typeId) throw new Error(`unknown type "${typeCode}"`);
        let price: number;
        const gemsRaw = get('price_gems');
        const usdRaw = get('price_usd');
        if (gemsRaw) {
          price = Number(gemsRaw.replace(/\s/g, ''));
          if (!Number.isSafeInteger(price) || price < 0) throw new Error('price_gems must be a non-negative integer');
        } else if (usdRaw) {
          price = usdToGemsRounded(usdRaw.replace(',', '.'), gemsPerUsd);
        } else {
          throw new Error('price is empty');
        }
        const wearRaw = get('wear')?.toUpperCase();
        const wear = wearRaw ? (wearRaw as ItemWear) : null;
        if (wear && !ITEM_WEARS.includes(wear)) throw new Error(`invalid wear "${wearRaw}"`);
        if (wear && !game.features.wear) throw new Error('wear is not supported for this game');

        const modelCode = get('model');
        let modelId: number | null = null;
        if (modelCode) {
          await this.db
            .insert(itemModels)
            .values({ gameId: game.id, typeId, code: modelCode.toLowerCase(), name: modelCode })
            .onConflictDoNothing();
          const [m] = await this.db
            .select({ id: itemModels.id })
            .from(itemModels)
            .where(and(eq(itemModels.gameId, game.id), eq(itemModels.code, modelCode.toLowerCase())));
          modelId = m?.id ?? null;
        }
        const collectionCode = get('collection');
        let collectionId: number | null = null;
        if (collectionCode) {
          const code = collectionCode.toLowerCase().replace(/\s+/g, '_');
          await this.db.insert(collections).values({ gameId: game.id, code, name: collectionCode }).onConflictDoNothing();
          const [c] = await this.db
            .select({ id: collections.id })
            .from(collections)
            .where(and(eq(collections.gameId, game.id), eq(collections.code, code)));
          collectionId = c?.id ?? null;
        }

        const values = {
          typeId,
          modelId,
          rarityId,
          collectionId,
          skinName: get('skin_name') || marketName,
          fullName: get('full_name') || marketName,
          imageUrl: get('image_url') || null,
          price,
          isStattrak: truthy(get('stattrak'), false),
          isSouvenir: truthy(get('souvenir'), false),
          wear,
          floatMin: get('float_min') || null,
          floatMax: get('float_max') || null,
          isWithdrawable: truthy(get('withdrawable'), true),
          isActive: truthy(get('active'), true),
        };
        await this.db.transaction(async (tx) => {
          const [existing] = await tx
            .select({ id: items.id, price: items.price })
            .from(items)
            .where(and(eq(items.gameId, game.id), eq(items.marketName, marketName)))
            .for('update');
          if (existing) {
            await tx.update(items).set({ ...values, updatedAt: sql`now()`, priceUpdatedAt: existing.price !== price ? sql`now()` : undefined }).where(eq(items.id, existing.id));
            if (existing.price !== price) {
              await tx.insert(itemPriceHistory).values({
                itemId: existing.id,
                price,
                sourcePrice: usdRaw && !gemsRaw ? usdRaw : null,
                sourceCurrency: usdRaw && !gemsRaw ? 'USD' : null,
                source: 'csv',
                actorId,
              });
            }
            result.updated++;
          } else {
            const id = newId();
            await tx.insert(items).values({ id, gameId: game.id, marketName, ...values });
            await tx.insert(itemPriceHistory).values({ itemId: id, price, source: 'csv', actorId });
            result.created++;
          }
        });
      } catch (err) {
        result.skipped++;
        if (result.errors.length < 200) result.errors.push({ line, message: (err as Error).message });
      }
    }

    await this.db
      .update(catalogImports)
      .set({
        status: 'done',
        stats: { created: result.created, updated: result.updated, skipped: result.skipped },
        errors: result.errors,
        finishedAt: sql`now()`,
      })
      .where(eq(catalogImports.id, importId));
    await this.audit.log({
      actorId,
      action: 'catalog.import',
      entityType: 'catalog_import',
      entityId: importId,
      after: { game: game.code, fileName, created: result.created, updated: result.updated, skipped: result.skipped },
    });
    return result;
  }
}
