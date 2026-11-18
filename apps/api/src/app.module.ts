import { Module, type DynamicModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import type { Env } from './config/env.js';
import { CoreModule } from './core/core.module.js';
import { AllExceptionsFilter } from './common/exception.filter.js';
import { AdminModule } from './modules/admin/admin.module.js';
import { CasesModule } from './modules/cases/cases.module.js';
import { CatalogModule } from './modules/catalog/catalog.module.js';
import { InventoryModule } from './modules/inventory/inventory.module.js';
import { LedgerModule } from './modules/ledger/ledger.module.js';
import { ModesModule } from './modules/modes/modes.module.js';
import { PaymentsModule } from './modules/payments/payments.module.js';
import { ProfileModule } from './modules/profile/profile.module.js';
import { AuthGuard } from './modules/auth/auth.guard.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { GamesModule } from './modules/games/games.module.js';
import { RateLimitGuard } from './modules/rate-limit/rate-limit.guard.js';
import { RealtimeModule } from './modules/realtime/realtime.module.js';
import { SiteModule } from './modules/site/site.module.js';
import { UsersModule } from './modules/users/users.module.js';

@Module({})
export class AppModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: AppModule,
      imports: [
        CoreModule.forRoot(env),
        UsersModule,
        AuthModule,
        GamesModule,
        RealtimeModule,
        SiteModule,
        AdminModule,
        LedgerModule,
        CatalogModule,
        InventoryModule,
        PaymentsModule,
        ProfileModule,
        CasesModule,
        ModesModule,
      ],
      providers: [
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
        // Порядок важен: сначала вход (нужен userId для ключа лимита), потом лимиты.
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_GUARD, useClass: RateLimitGuard },
      ],
    };
  }
}
