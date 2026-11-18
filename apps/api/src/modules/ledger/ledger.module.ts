import { Global, Module } from '@nestjs/common';
import { IdempotencyService } from '../../common/idempotency.js';
import { AdminLedgerController } from './admin-ledger.controller.js';
import { LedgerService } from './ledger.service.js';

@Global()
@Module({
  controllers: [AdminLedgerController],
  providers: [LedgerService, IdempotencyService],
  exports: [LedgerService, IdempotencyService],
})
export class LedgerModule {}
