import { Module } from '@nestjs/common';
import { AdminCatalogController } from './admin-catalog.controller.js';
import { CatalogController } from './catalog.controller.js';
import { CatalogService } from './catalog.service.js';
import { CsvImportService } from './csv-import.service.js';
import { DbPriceProvider, PRICE_PROVIDER, PricesService } from './prices.js';

@Module({
  controllers: [CatalogController, AdminCatalogController],
  providers: [
    CatalogService,
    CsvImportService,
    PricesService,
    { provide: PRICE_PROVIDER, useClass: DbPriceProvider },
  ],
  exports: [CatalogService, PricesService],
})
export class CatalogModule {}
