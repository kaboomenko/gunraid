import { Module, type DynamicModule } from '@nestjs/common';
import type { Env } from './config/env.js';
import { CoreModule } from './core/core.module.js';
import { FeedWorkerModule } from './modules/feed/feed-worker.module.js';
import { LedgerModule } from './modules/ledger/ledger.module.js';
import { MaintenanceModule } from './modules/maintenance/maintenance.module.js';

@Module({})
export class WorkerModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: WorkerModule,
      imports: [
        CoreModule.forRoot(env, { dbPoolSize: 10 }),
        LedgerModule,
        MaintenanceModule,
        FeedWorkerModule,
      ],
    };
  }
}
