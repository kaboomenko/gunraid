import { Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { OutboxProcessor } from '../outbox/outbox.processor.js';
import { CargoNotifier } from './cargo.notifier.js';
import { CargoService } from './cargo.service.js';

/** Первый проход тикера после старта воркера (сиды создают только шаблоны — раунды открывает он, D35). */
const BOOT_DELAY_MS = 5_000;
const TICK_MS = 10_000;

/**
 * Воркер: приземление по сроку (событие outbox `cargo.deadline`, D3) и тикер — страховка: каждые 10 с приземляет
 * просроченные и распроданные раунды и открывает недостающие. Несколько воркеров безопасны: `skip locked` разводит
 * их по разным раундам, строка раунда блокируется и статус проверяется, у шаблона один открытый раунд.
 */
@Injectable()
export class CargoHandlers implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(CargoHandlers.name);
  private running = false;
  private boot: NodeJS.Timeout | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly outbox: OutboxProcessor,
    private readonly cargo: CargoService,
    private readonly notifier: CargoNotifier,
  ) {}

  /**
   * Один проход тикера. Пока идёт предыдущий — no-op (как OutboxProcessor.tick): медленный проход (до 50 приземлений
   * и открытие раундов) не накладывается на следующий и не выбирает пул воркера. Публичный — для теста.
   */
  async sweepOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const s = await this.cargo.sweep();
      s.landed.forEach((l) => this.notifier.finished(l));
      s.opened.forEach((o) => this.notifier.opened(o));
    } catch (err) {
      this.logger.error(`cargo sweep: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  onModuleInit(): void {
    this.outbox.on('cargo.deadline', async (p) => {
      const res = await this.cargo.onDeadline((p as { roundId: string }).roundId);
      if (res) this.notifier.finished(res);
    });
    this.boot = setTimeout(() => void this.sweepOnce(), BOOT_DELAY_MS);
    this.boot.unref?.();
    this.timer = setInterval(() => void this.sweepOnce(), TICK_MS);
    this.timer.unref?.();
  }

  onApplicationShutdown(): void {
    if (this.boot) clearTimeout(this.boot);
    if (this.timer) clearInterval(this.timer);
  }
}
