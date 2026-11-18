import { Module } from '@nestjs/common';
import { CatalogService } from '../catalog/catalog.service.js';
import { FeedWorkerModule } from '../feed/feed-worker.module.js';
import { AchievementsService } from './achievements.service.js';
import { BonusesHandlers } from './bonuses.handlers.js';
import { LeaderboardService } from './leaderboard.service.js';
import { LevelsService } from './levels.service.js';
import { ReferralService } from './referral.service.js';

/** Воркер: обработчики бонусных событий и итоги лидербордов. Без контроллеров. */
@Module({
  imports: [FeedWorkerModule],
  providers: [
    BonusesHandlers,
    LevelsService,
    ReferralService,
    LeaderboardService,
    AchievementsService,
    CatalogService,
  ],
})
export class BonusesWorkerModule {}
