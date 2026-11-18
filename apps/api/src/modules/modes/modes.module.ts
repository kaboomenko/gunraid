import { Module } from '@nestjs/common';
import { CasesModule } from '../cases/cases.module.js';
import { CatalogModule } from '../catalog/catalog.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { ContractService } from './contract.service.js';
import { ModesController, ModesProofController } from './modes.controller.js';
import { UpgradeService } from './upgrade.service.js';

@Module({
  imports: [CatalogModule, InventoryModule, CasesModule],
  controllers: [ModesController, ModesProofController],
  providers: [UpgradeService, ContractService],
  exports: [UpgradeService, ContractService],
})
export class ModesModule {}
