import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module.js';
import { MaintenanceService } from './maintenance.service.js';

@Module({ imports: [CatalogModule], providers: [MaintenanceService] })
export class MaintenanceModule {}
