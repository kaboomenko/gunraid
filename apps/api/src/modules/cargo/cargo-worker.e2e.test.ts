import { randomBytes } from 'node:crypto';
import { Module, type INestApplicationContext, type Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { cargoRounds, cargoTemplates, items, newId, outboxEvents } from '@gunraid/db';
import type { CargoBuyResultDto } from '@gunraid/shared';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CoreModule } from '../../core/core.module.js';
import { createTestApp } from '../../test/app.js';
import { testEnv } from '../../test/env.js';
import { db, gameId, grantGems, newPlayer } from '../../test/fixtures.js';
import { WorkerModule } from '../../worker.module.js';
import type { InventoryService } from '../inventory/inventory.service.js';
import { LedgerModule } from '../ledger/ledger.module.js';
import { OutboxProcessor } from '../outbox/outbox.processor.js';
import { CargoHandlers } from './cargo.handlers.js';
import { CargoWorkerModule } from './cargo-worker.module.js';
import { CargoService } from './cargo.service.js';

@Module({})
class TestWorkerModule {}

let app: NestFastifyApplication;
let worker: INestApplicationContext;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  app = await createTestApp();
  // LedgerModule (глобальный) в воркере импортирует WorkerModule; здесь — явно: CargoService и InventoryService
  // берут из него LedgerService.
  worker = await NestFactory.createApplicationContext(
    {
      module: TestWorkerModule,
      imports: [CoreModule.forRoot(testEnv()), LedgerModule, CargoWorkerModule],
    },
    { logger: false },
  );
});

const created: string[] = [];
async function createTemplate(over: Partial<typeof cargoTemplates.$inferInsert> = {}) {
  const gid = await gameId(app, 'cs2');
  const [item] = await db(app)
    .select({ id: items.id })
    .from(items)
    .where(and(eq(items.gameId, gid), eq(items.isActive, true)))
    .orderBy(asc(items.price), asc(items.id))
    .limit(1);
  const id = newId();
  const slug = `w-${id.slice(-12)}`;
  await db(app)
    .insert(cargoTemplates)
    .values({
      id,
      gameId: gid,
      slug,
      name: { ru: 'Тестовый груз воркера' },
      imageUrl: '/media/cargo/signal.webp',
      prizeItemId: item!.id,
      seatsTotal: 3,
      seatPrice: 100,
      durationMinutes: 60,
      sortOrder: 100_000,
      ...over,
    });
  created.push(id);
  return { id, slug };
}

async function openRoundOf(templateId: string) {
  const [r] = await db(app)
    .select()
    .from(cargoRounds)
    .where(and(eq(cargoRounds.templateId, templateId), eq(cargoRounds.status, 'open')));
  return r ?? null;
}

/** Ждёт условие: обработчики воркера работают и по своим таймерам, поэтому — опрос с запасом по времени. */
async function until(cond: () => Promise<boolean>, step: () => Promise<unknown>, ms = 15_000) {
  const stop = Date.now() + ms;
  while (Date.now() < stop) {
    if (await cond()) return true;
    await step();
    await sleep(100);
  }
  return cond();
}

afterAll(async () => {
  if (created.length) {
    await db(app)
      .update(cargoTemplates)
      .set({ isActive: false })
      .where(inArray(cargoTemplates.id, created));
    const open = await db(app)
      .update(cargoRounds)
      .set({ endsAt: sql`now() - interval '1 second'` })
      .where(and(inArray(cargoRounds.templateId, created), eq(cargoRounds.status, 'open')))
      .returning({ id: cargoRounds.id });
    for (const { id } of open) await app.get(CargoService).land(id);
  }
  await worker.close();
  await app.close();
});

describe('cargo worker (integration)', () => {
  it('is wired into the worker: module, handlers and the outbox handler', () => {
    // forRoot только описывает модуль — соединений не открывает.
    expect(WorkerModule.forRoot(testEnv()).imports).toContain(CargoWorkerModule);
    expect(Reflect.getMetadata('providers', CargoWorkerModule)).toContain(CargoHandlers);
    // Событие без обработчика OutboxProcessor молча помечает обработанным (ловушка 4).
    const handlers = (
      worker.get(OutboxProcessor) as unknown as { handlers: Map<string, unknown[]> }
    ).handlers;
    expect(handlers.get('cargo.deadline')).toHaveLength(1);
  });

  it('lands a round by its cargo.deadline outbox event', async () => {
    const t = await createTemplate();
    const round = await db(app).transaction((tx) => app.get(CargoService).openRound(tx, t.id));
    const { client, me } = await newPlayer(app, 'cw');
    await grantGems(app, me.id, 1_000);
    const res = await client.post<CargoBuyResultDto>(
      `/api/v1/games/cs2/cargo/${t.slug}/buy`,
      { roundId: round!.id, count: 1, clientSeed: randomBytes(16).toString('hex') },
      { 'idempotency-key': crypto.randomUUID() },
    );
    expect(res.status).toBe(200);
    await db(app)
      .update(cargoRounds)
      .set({ endsAt: sql`now() - interval '1 second'` })
      .where(eq(cargoRounds.id, round!.id));
    const moved = await db(app)
      .update(outboxEvents)
      .set({ availableAt: sql`now() - interval '1 second'` })
      .where(
        and(
          eq(outboxEvents.type, 'cargo.deadline'),
          sql`${outboxEvents.payload}->>'roundId' = ${round!.id}`,
          isNull(outboxEvents.processedAt),
        ),
      )
      .returning({ id: outboxEvents.id });
    expect(moved).toHaveLength(1);

    const processor = worker.get(OutboxProcessor);
    const status = async () =>
      (
        await db(app)
          .select({ status: cargoRounds.status })
          .from(cargoRounds)
          .where(eq(cargoRounds.id, round!.id))
      )[0]?.status;
    expect(
      await until(
        async () => (await status()) !== 'open',
        () => processor.tick(),
      ),
    ).toBe(true);
    const [landed] = await db(app).select().from(cargoRounds).where(eq(cargoRounds.id, round!.id));
    expect(landed).toMatchObject({ status: 'landed', landReason: 'deadline', winnerId: me.id });
    expect((await openRoundOf(t.id))?.number).toBe(2);
  });

  it('a failing deadline event keeps the DB cause, not the SQL with the winner (outbox last_error)', async () => {
    const t = await createTemplate();
    const round = (await db(app).transaction((tx) => app.get(CargoService).openRound(tx, t.id)))!;
    const { client, me } = await newPlayer(app, 'cwf');
    await grantGems(app, me.id, 1_000);
    const res = await client.post<CargoBuyResultDto>(
      `/api/v1/games/cs2/cargo/${t.slug}/buy`,
      { roundId: round.id, count: 1, clientSeed: randomBytes(16).toString('hex') },
      { 'idempotency-key': crypto.randomUUID() },
    );
    expect(res.status).toBe(200);
    const [ev] = await db(app)
      .select({ id: outboxEvents.id })
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.type, 'cargo.deadline'),
          sql`${outboxEvents.payload}->>'roundId' = ${round.id}`,
          isNull(outboxEvents.processedAt),
        ),
      );
    const event = async () =>
      (await db(app).select().from(outboxEvents).where(eq(outboxEvents.id, ev!.id)))[0];

    // Настоящая ошибка БД в воркере: приза нет (внешний ключ user_items → items); единственный покупатель — победитель,
    // его id есть в параметрах упавшего запроса. Подмена — до срока раунда: фоновый тикер воркера не приземлит его раньше.
    const inventory = (worker.get(CargoService) as unknown as { inventory: InventoryService })
      .inventory;
    const original = inventory.grant.bind(inventory);
    const grant = vi
      .spyOn(inventory, 'grant')
      .mockImplementation((tx, input) =>
        original(tx, input.sourceId === round.id ? { ...input, itemId: newId() } : input),
      );
    const processor = worker.get(OutboxProcessor);
    const warn = vi.spyOn((processor as unknown as { logger: Logger }).logger, 'warn');
    let warned: string[];
    let failed: Awaited<ReturnType<typeof event>>;
    let stuck: typeof cargoRounds.$inferSelect | undefined;
    try {
      await db(app)
        .update(cargoRounds)
        .set({ endsAt: sql`now() - interval '1 second'` })
        .where(eq(cargoRounds.id, round.id));
      await db(app)
        .update(outboxEvents)
        .set({ availableAt: sql`now() - interval '1 second'` })
        .where(eq(outboxEvents.id, ev!.id));
      expect(
        await until(
          async () => ((await event())?.attempts ?? 0) > 0,
          () => processor.tick(),
        ),
      ).toBe(true);
      // До снятия подмены: иначе фоновый тик воркера может успеть приземлить раунд.
      failed = await event();
      [stuck] = await db(app).select().from(cargoRounds).where(eq(cargoRounds.id, round.id));
      warned = warn.mock.calls
        .map(([m]) => String(m))
        .filter((m) => m.includes(`cargo.deadline#${ev!.id}`));
    } finally {
      grant.mockRestore();
      warn.mockRestore();
    }
    expect(stuck?.status).toBe('open');
    expect(warned.length).toBeGreaterThan(0);
    for (const text of [failed?.lastError, stuck?.lastLandError, ...warned]) {
      expect(text).toMatch(/\[23503\] insert or update on table "user_items" violates foreign key/);
      expect(text).not.toMatch(/Failed query|params:|values \(/);
      expect(text).not.toContain(me.id);
    }
    await app.get(CargoService).land(round.id);
    const [landed] = await db(app).select().from(cargoRounds).where(eq(cargoRounds.id, round.id));
    expect(landed).toMatchObject({ status: 'landed', winnerId: me.id });
  });

  it('the ticker opens a round for an active template without one', async () => {
    const t = await createTemplate();
    expect(await openRoundOf(t.id)).toBeNull();
    const handlers = worker.get(CargoHandlers);
    expect(
      await until(
        async () => (await openRoundOf(t.id)) !== null,
        () => handlers.sweepOnce(),
      ),
    ).toBe(true);
    expect((await openRoundOf(t.id))?.number).toBe(1);
  });
});
