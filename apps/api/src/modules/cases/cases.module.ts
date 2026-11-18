import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module.js';
import { FairnessController } from '../fairness/fairness.controller.js';
import { FairnessService } from '../fairness/fairness.service.js';
import { FeedService } from '../feed/feed.service.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { CasesController } from './cases.controller.js';
import { CasesService } from './cases.service.js';

@Module({
  imports: [CatalogModule, InventoryModule],
  controllers: [CasesController, FairnessController],
  providers: [CasesService, FairnessService, FeedService],
  exports: [CasesService, FairnessService, FeedService],
})
export class CasesModule {}
