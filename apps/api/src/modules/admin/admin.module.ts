import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CatalogModule } from '../catalog/catalog.module.js';
import { AdminBonusesService } from './admin-bonuses.service.js';
import { AdminContentService } from './admin-content.service.js';
import { AdminDashboardService } from './admin-dashboard.service.js';
import { AdminSystemService } from './admin-system.service.js';
import { AdminUsersService } from './admin-users.service.js';
import {
  AdminBonusesController,
  AdminContentController,
  AdminController,
  AdminSystemController,
} from './admin.controller.js';

@Module({
  imports: [AuthModule, CatalogModule],
  controllers: [
    AdminController,
    AdminSystemController,
    AdminContentController,
    AdminBonusesController,
  ],
  providers: [
    AdminUsersService,
    AdminDashboardService,
    AdminContentService,
    AdminBonusesService,
    AdminSystemService,
  ],
})
export class AdminModule {}
