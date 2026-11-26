import { Module } from '@nestjs/common';
import { CasesModule } from '../cases/cases.module.js';
import { CatalogModule } from '../catalog/catalog.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { AdminCargoController } from './admin-cargo.controller.js';
import { AdminCargoService } from './admin-cargo.service.js';
import { CargoController, CargoProofController } from './cargo.controller.js';
import { CargoNotifier } from './cargo.notifier.js';
import { CargoService } from './cargo.service.js';

/**
 * API грузов: публичные ручки, покупка (с приземлением при распродаже), доказательство раунда; админка грузов
 * (шаблоны, раунды, отмена с возвратом, сверка).
 */
@Module({
  imports: [CatalogModule, InventoryModule, CasesModule],
  controllers: [CargoController, CargoProofController, AdminCargoController],
  providers: [CargoService, CargoNotifier, AdminCargoService],
  exports: [CargoService, CargoNotifier],
})
export class CargoModule {}
