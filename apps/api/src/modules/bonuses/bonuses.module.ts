import { Module } from '@nestjs/common';
import { CasesModule } from '../cases/cases.module.js';
import { CatalogModule } from '../catalog/catalog.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { AchievementsService } from './achievements.service.js';
import { BonusesController } from './bonuses.controller.js';
import { DailyService } from './daily.service.js';
import { LeaderboardService } from './leaderboard.service.js';
import { LevelsService } from './levels.service.js';
import { PromoService } from './promo.service.js';
import { ReferralService } from './referral.service.js';
import { WheelService } from './wheel.service.js';

const SERVICES = [
  LevelsService,
  DailyService,
  WheelService,
  PromoService,
  ReferralService,
  LeaderboardService,
  AchievementsService,
];

@Module({
  imports: [CatalogModule, InventoryModule, CasesModule],
  controllers: [BonusesController],
  providers: SERVICES,
  exports: SERVICES,
})
export class BonusesModule {}
