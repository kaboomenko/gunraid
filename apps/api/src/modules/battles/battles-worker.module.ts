import { Module } from '@nestjs/common';
import { CatalogService } from '../catalog/catalog.service.js';
import { FairnessService } from '../fairness/fairness.service.js';
import { FeedWorkerModule } from '../feed/feed-worker.module.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { BattlesHandlers } from './battles.handlers.js';
import { BattlesNotifier } from './battles.notifier.js';
import { BattlesService } from './battles.service.js';

/** Воркер: движок раундов баттлов (через outbox). Без контроллеров. */
@Module({
  imports: [FeedWorkerModule],
  providers: [
    BattlesService,
    BattlesNotifier,
    BattlesHandlers,
    CatalogService,
    InventoryService,
    FairnessService,
  ],
})
export class BattlesWorkerModule {}
