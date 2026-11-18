import { Controller, Get } from '@nestjs/common';
import { Auth, RateLimit } from '../../common/auth.decorators.js';
import { LedgerService } from './ledger.service.js';

@Controller('admin/ledger')
@Auth({ roles: ['admin'] })
@RateLimit('admin')
export class AdminLedgerController {
  constructor(private readonly ledger: LedgerService) {}

  /** Сверка баланса с ledger: пустой список — всё сходится. */
  @Get('reconciliation')
  async reconciliation() {
    const mismatches = await this.ledger.reconcile();
    return { ok: mismatches.length === 0, mismatches, checkedAt: new Date().toISOString() };
  }
}
