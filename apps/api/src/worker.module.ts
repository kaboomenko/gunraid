import { Module, type DynamicModule } from '@nestjs/common';
import type { Env } from './config/env.js';
import { CoreModule } from './core/core.module.js';
import { BattlesWorkerModule } from './modules/battles/battles-worker.module.js';
import { BonusesWorkerModule } from './modules/bonuses/bonuses-worker.module.js';
import { CargoWorkerModule } from './modules/cargo/cargo-worker.module.js';
import { WithdrawalsWorkerModule } from './modules/withdrawals/withdrawals-worker.module.js';
import { FeedWorkerModule } from './modules/feed/feed-worker.module.js';
import { LedgerModule } from './modules/ledger/ledger.module.js';
import { MaintenanceModule } from './modules/maintenance/maintenance.module.js';

@Module({})
export class WorkerModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: WorkerModule,
      imports: [
        CoreModule.forRoot(env, { dbPoolSize: 10, role: 'worker' }),
        LedgerModule,
        MaintenanceModule,
        FeedWorkerModule,
        BattlesWorkerModule,
        CargoWorkerModule,
        BonusesWorkerModule,
        WithdrawalsWorkerModule,
      ],
    };
  }
}
