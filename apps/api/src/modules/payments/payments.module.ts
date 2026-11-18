import { Module } from '@nestjs/common';
import { DepositsController, PaymentsController } from './payments.controller.js';
import { PaymentsService } from './payments.service.js';
import {
  DbFxRateProvider,
  FX_RATE_PROVIDER,
  MockPaymentProvider,
  PAYMENT_PROVIDERS,
} from './providers.js';

@Module({
  controllers: [PaymentsController, DepositsController],
  providers: [
    PaymentsService,
    MockPaymentProvider,
    { provide: FX_RATE_PROVIDER, useClass: DbFxRateProvider },
    // Новые провайдеры добавляются в этот список.
    {
      provide: PAYMENT_PROVIDERS,
      useFactory: (mock: MockPaymentProvider) => [mock],
      inject: [MockPaymentProvider],
    },
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}
