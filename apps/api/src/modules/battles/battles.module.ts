import { Module } from '@nestjs/common';
import { CasesModule } from '../cases/cases.module.js';
import { CatalogModule } from '../catalog/catalog.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { BattlesController, BattlesProofController } from './battles.controller.js';
import { BattlesNotifier } from './battles.notifier.js';
import { BattlesService } from './battles.service.js';

@Module({
  imports: [CatalogModule, InventoryModule, CasesModule],
  controllers: [BattlesController, BattlesProofController],
  providers: [BattlesService, BattlesNotifier],
  exports: [BattlesService],
})
export class BattlesModule {}
