import {
  Injectable,
  Logger,
  Module,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { CatalogService } from '../catalog/catalog.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { WithdrawalsService } from './withdrawals.service.js';

const TICK_MS = 60_000;

/** Воркер: таймауты лотов Standoff 2 и завершение CS2 после периода защиты сделки. */
@Injectable()
export class WithdrawalsTicker implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(WithdrawalsTicker.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly withdrawals: WithdrawalsService) {}

  onModuleInit(): void {
    const tick = () =>
      void this.withdrawals
        .tick()
        .catch((err: unknown) => this.logger.error(`withdrawals tick: ${(err as Error).message}`));
    setTimeout(tick, 7_000).unref?.();
    this.timer = setInterval(tick, TICK_MS);
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }
}

@Module({
  providers: [WithdrawalsTicker, WithdrawalsService, CatalogService, InventoryService],
})
export class WithdrawalsWorkerModule {}
