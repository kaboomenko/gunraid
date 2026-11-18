import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { fairSeeds, newId, type Db, type DbOrTx } from '@gunraid/db';
import { sha256Hex } from '@gunraid/game-core';
import type { FairSeedDto, PageDto, RevealedSeedDto, RotateSeedResultDto } from '@gunraid/shared';
import { and, desc, eq, lt, sql } from 'drizzle-orm';
import type { Env } from '../../config/env.js';
import { DB, ENV } from '../../core/tokens.js';

type SeedRow = typeof fairSeeds.$inferSelect;

export interface ReservedRolls {
  seedId: string;
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  nonces: number[];
}

/** Пары сидов provably fair: server seed зашифрован (AES-256-GCM), хэш показывается заранее. */
@Injectable()
export class FairnessService {
  private readonly key: Buffer;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) env: Env,
  ) {
    this.key = Buffer.from(env.FAIR_SEED_KEY, 'hex');
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64');
  }

  decrypt(enc: string): string {
    const buf = Buffer.from(enc, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', this.key, buf.subarray(0, 12));
    decipher.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
  }

  newServerSeed(): string {
    return randomBytes(32).toString('hex');
  }

  newClientSeed(): string {
    return randomBytes(8).toString('hex');
  }

  private async insertSeed(tx: DbOrTx, userId: string, clientSeed?: string): Promise<SeedRow> {
    const serverSeed = this.newServerSeed();
    const [row] = await tx
      .insert(fairSeeds)
      .values({
        id: newId(),
        userId,
        serverSeedEnc: this.encrypt(serverSeed),
        serverSeedHash: sha256Hex(serverSeed),
        clientSeed: clientSeed ?? this.newClientSeed(),
      })
      .onConflictDoNothing()
      .returning();
    if (row) return row;
    const [existing] = await tx
      .select()
      .from(fairSeeds)
      .where(and(eq(fairSeeds.userId, userId), eq(fairSeeds.status, 'active')));
    if (!existing) throw new Error('fair seed race');
    return existing;
  }

  /** Активная пара под блокировкой (создаётся при первой ставке). */
  async lockActive(tx: DbOrTx, userId: string): Promise<SeedRow> {
    const [row] = await tx
      .select()
      .from(fairSeeds)
      .where(and(eq(fairSeeds.userId, userId), eq(fairSeeds.status, 'active')))
      .for('update');
    if (row) return row;
    await this.insertSeed(tx, userId);
    const [created] = await tx
      .select()
      .from(fairSeeds)
      .where(and(eq(fairSeeds.userId, userId), eq(fairSeeds.status, 'active')))
      .for('update');
    if (!created) throw new Error('fair seed missing');
    return created;
  }

  /** Резервирует count подряд идущих nonce для одной операции. */
  async reserve(tx: DbOrTx, userId: string, count: number): Promise<ReservedRolls> {
    const seed = await this.lockActive(tx, userId);
    await tx
      .update(fairSeeds)
      .set({ nonce: sql`${fairSeeds.nonce} + ${count}` })
      .where(eq(fairSeeds.id, seed.id));
    return {
      seedId: seed.id,
      serverSeed: this.decrypt(seed.serverSeedEnc),
      serverSeedHash: seed.serverSeedHash,
      clientSeed: seed.clientSeed,
      nonces: Array.from({ length: count }, (_, i) => seed.nonce + i),
    };
  }

  async current(userId: string): Promise<FairSeedDto> {
    const seed = await this.db.transaction((tx) => this.lockActive(tx, userId));
    return { serverSeedHash: seed.serverSeedHash, clientSeed: seed.clientSeed, nonce: seed.nonce };
  }

  /** Смена пары: текущий server seed раскрывается, выдаётся новая пара (с новым client seed, если задан). */
  async rotate(userId: string, clientSeed?: string): Promise<RotateSeedResultDto> {
    return this.db.transaction(async (tx) => {
      const old = await this.lockActive(tx, userId);
      const [revealed] = await tx
        .update(fairSeeds)
        .set({ status: 'revealed', revealedAt: sql`now()` })
        .where(eq(fairSeeds.id, old.id))
        .returning();
      const next = await this.insertSeed(tx, userId, clientSeed);
      if (!revealed) throw new Error('rotate failed');
      return {
        revealed: this.toRevealed(revealed),
        current: { serverSeedHash: next.serverSeedHash, clientSeed: next.clientSeed, nonce: next.nonce },
      };
    });
  }

  toRevealed(row: SeedRow): RevealedSeedDto {
    return {
      id: row.id,
      serverSeed: this.decrypt(row.serverSeedEnc),
      serverSeedHash: row.serverSeedHash,
      clientSeed: row.clientSeed,
      nonce: row.nonce,
      createdAt: row.createdAt.toISOString(),
      revealedAt: (row.revealedAt ?? row.createdAt).toISOString(),
    };
  }

  async revealed(userId: string, cursor?: string, limit = 20): Promise<PageDto<RevealedSeedDto>> {
    const base = and(eq(fairSeeds.userId, userId), eq(fairSeeds.status, 'revealed'));
    const rows = await this.db
      .select()
      .from(fairSeeds)
      .where(cursor ? and(base, lt(fairSeeds.revealedAt, new Date(cursor))) : base)
      .orderBy(desc(fairSeeds.revealedAt))
      .limit(limit + 1);
    const page = rows.slice(0, limit).map((r) => this.toRevealed(r));
    return { items: page, nextCursor: rows.length > limit ? (page[page.length - 1]?.revealedAt ?? null) : null };
  }

  async getSeed(seedId: string): Promise<SeedRow | null> {
    const [row] = await this.db.select().from(fairSeeds).where(eq(fairSeeds.id, seedId));
    return row ?? null;
  }
}
