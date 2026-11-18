import {
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  type RawBodyRequest,
} from '@nestjs/common';
import {
  createDepositSchema,
  depositQuoteSchema,
  mockCompleteSchema,
  type DepositDto,
  type DepositQuoteBody,
} from '@gunraid/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Auth, CurrentUser, RateLimit, type AuthContext } from '../../common/auth.decorators.js';
import { IdempotencyService, requireIdempotencyKey } from '../../common/idempotency.js';
import { ZBody } from '../../common/zod.js';
import { PaymentsService } from './payments.service.js';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get('methods')
  @Auth()
  methods() {
    return this.payments.methods();
  }

  /** Вебхук провайдера: без cookie и CSRF, проверяется подписью. */
  @Post('webhook/:provider')
  @HttpCode(200)
  async webhook(@Param('provider') provider: string, @Req() req: RawBodyRequest<FastifyRequest>) {
    const raw = req.rawBody?.toString('utf8') ?? JSON.stringify(req.body ?? {});
    return this.payments.handleWebhook(provider, raw, req.headers);
  }

  /** ЗАГЛУШКА: страница тестовой оплаты вызывает этот метод кнопками «успех» / «ошибка». */
  @Post('mock/:id/complete')
  @HttpCode(200)
  @Auth({ adult: true })
  @RateLimit('payment')
  mockComplete(
    @Param('id') id: string,
    @ZBody(mockCompleteSchema) body: { result: 'success' | 'fail' },
    @CurrentUser() user: AuthContext,
  ) {
    return this.payments.mockComplete(user.userId, id, body.result);
  }
}

@Controller('deposits')
@Auth({ adult: true })
export class DepositsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Post('quote')
  @HttpCode(200)
  @RateLimit('payment')
  quote(@ZBody(depositQuoteSchema) body: DepositQuoteBody, @CurrentUser() user: AuthContext) {
    return this.payments.quote(user.userId, body);
  }

  @Post()
  @HttpCode(201)
  @RateLimit('payment')
  async create(
    @ZBody(createDepositSchema) body: { quoteId: string },
    @CurrentUser() user: AuthContext,
    @Req() req: FastifyRequest,
  ): Promise<DepositDto> {
    const key = requireIdempotencyKey(req);
    const { result } = await this.idempotency.run(user.userId, key, 'deposit', body, (tx) =>
      this.payments.createDeposit(tx, user.userId, body.quoteId),
    );
    return result;
  }

  @Get()
  @Auth()
  list(@CurrentUser() user: AuthContext, @Query('cursor') cursor?: string) {
    const c = cursor ? z.string().datetime().parse(cursor) : undefined;
    return this.payments.listDeposits(user.userId, c);
  }

  @Get(':id')
  @Auth()
  get(@Param('id') id: string, @CurrentUser() user: AuthContext) {
    return this.payments.getDeposit(user.userId, id);
  }
}
