import { Module } from '@nestjs/common';
import { CatalogService } from '../catalog/catalog.service.js';
import { FairnessService } from '../fairness/fairness.service.js';
import { FeedWorkerModule } from '../feed/feed-worker.module.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { CargoHandlers } from './cargo.handlers.js';
import { CargoNotifier } from './cargo.notifier.js';
import { CargoService } from './cargo.service.js';

/**
 * Воркер: приземление раундов грузов по сроку (outbox `cargo.deadline`) и тикер (приземление просроченных,
 * открытие недостающих раундов). Без контроллеров. Без CargoHandlers событие outbox молча считалось бы обработанным.
 */
@Module({
  imports: [FeedWorkerModule],
  providers: [
    CargoService,
    CargoNotifier,
    CargoHandlers,
    CatalogService,
    InventoryService,
    FairnessService,
  ],
})
export class CargoWorkerModule {}
