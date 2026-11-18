import { Controller, Get, HttpCode, Patch, Post, Put, Req } from '@nestjs/common';
import {
  adminAchievementSchema,
  adminAuditQuerySchema,
  adminBalanceAdjustSchema,
  adminBanSchema,
  adminBulkPriceSchema,
  adminCaseContentsSchema,
  adminCaseSchema,
  adminDashboardQuerySchema,
  adminDepositsQuerySchema,
  adminItemPatchSchema,
  adminItemsQuerySchema,
  adminLeaderboardSchema,
  adminLevelsSchema,
  adminPartnerSchema,
  adminPromoSchema,
  adminRarityPatchSchema,
  adminUserPatchSchema,
  adminUsersQuerySchema,
  adminWheelPrizeSchema,
  fxRateSchema,
  gameCodeSchema,
  SETTINGS_KEYS,
  type AdminAchievementBody,
  type AdminBalanceAdjustBody,
  type AdminBanBody,
  type AdminBulkPriceBody,
  type AdminCaseBody,
  type AdminCaseContentsBody,
  type AdminDashboardQuery,
  type AdminItemPatchBody,
  type AdminItemsQuery,
  type AdminLeaderboardBody,
  type AdminLevelsBody,
  type AdminPartnerBody,
  type AdminPromoBody,
  type AdminUserPatchBody,
  type AdminUsersQuery,
  type AdminWheelPrizeBody,
  type SettingsKey,
} from '@gunraid/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { RealtimeEmitter } from '../../core/realtime-emitter.js';
import { Auth, CurrentUser, RateLimit, type AuthContext } from '../../common/auth.decorators.js';
import { requireIdempotencyKey } from '../../common/idempotency.js';
import { ZBody, ZParam, ZQuery } from '../../common/zod.js';
import { GamesService } from '../games/games.service.js';
import { AdminBonusesService } from './admin-bonuses.service.js';
import { AdminContentService } from './admin-content.service.js';
import { AdminDashboardService } from './admin-dashboard.service.js';
import { AdminSystemService } from './admin-system.service.js';
import { AdminUsersService } from './admin-users.service.js';

const idSchema = z.string().uuid();
const intIdSchema = z.coerce.number().int().positive();
const pageQuery = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
});
const refsQuery = z.object({ q: z.string().trim().max(80).default('') });
const ip = (req: FastifyRequest) => req.ip ?? null;

/** Пользователи: support — просмотр, admin — действия. */
@Controller('admin')
@Auth({ roles: ['support', 'admin'] })
@RateLimit('admin')
export class AdminController {
  constructor(
    private readonly usersAdmin: AdminUsersService,
    private readonly realtime: RealtimeEmitter,
  ) {}

  @Get('ping')
  ping(@CurrentUser() user: AuthContext) {
    return { ok: true, role: user.role };
  }

  @Get('users')
  users(@ZQuery(adminUsersQuerySchema) q: AdminUsersQuery) {
    return this.usersAdmin.list(q);
  }

  @Get('users/:id')
  user(@ZParam('id', idSchema) id: string) {
    return this.usersAdmin.detail(id);
  }

  @Get('users/:id/ledger')
  ledger(@ZParam('id', idSchema) id: string, @ZQuery(pageQuery) q: z.infer<typeof pageQuery>) {
    return this.usersAdmin.ledgerPage(id, q.page, q.pageSize);
  }

  @Post('users/:id/balance')
  @HttpCode(200)
  @Auth({ roles: ['admin'] })
  async balance(
    @ZParam('id', idSchema) id: string,
    @ZBody(adminBalanceAdjustSchema) body: AdminBalanceAdjustBody,
    @CurrentUser() user: AuthContext,
    @Req() req: FastifyRequest,
  ) {
    const key = requireIdempotencyKey(req);
    const balance = await this.usersAdmin.adjustBalance(
      user.userId,
      id,
      body.amount,
      body.reason,
      key,
      ip(req),
    );
    this.realtime.balance(id, balance);
    return { balance };
  }

  @Post('users/:id/ban')
  @HttpCode(200)
  @Auth({ roles: ['admin'] })
  async ban(
    @ZParam('id', idSchema) id: string,
    @ZBody(adminBanSchema) body: AdminBanBody,
    @CurrentUser() user: AuthContext,
    @Req() req: FastifyRequest,
  ) {
    await this.usersAdmin.ban(user.userId, id, body.reason, ip(req));
    return this.usersAdmin.detail(id);
  }

  @Post('users/:id/unban')
  @HttpCode(200)
  @Auth({ roles: ['admin'] })
  async unban(
    @ZParam('id', idSchema) id: string,
    @CurrentUser() user: AuthContext,
    @Req() req: FastifyRequest,
  ) {
    await this.usersAdmin.unban(user.userId, id, ip(req));
    return this.usersAdmin.detail(id);
  }

  @Patch('users/:id')
  @Auth({ roles: ['admin'] })
  async patch(
    @ZParam('id', idSchema) id: string,
    @ZBody(adminUserPatchSchema) body: AdminUserPatchBody,
    @CurrentUser() user: AuthContext,
    @Req() req: FastifyRequest,
  ) {
    await this.usersAdmin.patch({ userId: user.userId, role: user.role }, id, body, ip(req));
    return this.usersAdmin.detail(id);
  }
}

/** Дашборд, настройки, курсы, пополнения, аудит — только admin. */
@Controller('admin')
@Auth({ roles: ['admin'] })
@RateLimit('admin')
export class AdminSystemController {
  constructor(
    private readonly dashboard: AdminDashboardService,
    private readonly system: AdminSystemService,
  ) {}

  @Get('dashboard')
  getDashboard(@ZQuery(adminDashboardQuerySchema) q: AdminDashboardQuery) {
    return this.dashboard.get(q.days, q.game);
  }

  @Get('settings')
  settingsAll() {
    return this.system.allSettings();
  }

  @Put('settings/:key')
  putSetting(
    @ZParam('key', z.enum(SETTINGS_KEYS as [SettingsKey, ...SettingsKey[]])) key: SettingsKey,
    @ZBody(z.unknown()) body: unknown,
    @CurrentUser() user: AuthContext,
    @Req() req: FastifyRequest,
  ) {
    return this.system.putSetting(user.userId, key, body, ip(req));
  }

  @Get('fx-rates')
  fxRates() {
    return this.system.fxRatesList();
  }

  @Put('fx-rates/:currency')
  async putFx(
    @ZParam('currency', z.string().regex(/^[A-Z]{3,5}$/)) currency: string,
    @ZBody(fxRateSchema) body: { usdRate: string },
    @CurrentUser() user: AuthContext,
    @Req() req: FastifyRequest,
  ) {
    await this.system.putFxRate(user.userId, currency, body.usdRate, ip(req));
    return this.system.fxRatesList();
  }

  @Get('deposits')
  deposits(@ZQuery(adminDepositsQuerySchema) q: z.infer<typeof adminDepositsQuerySchema>) {
    return this.system.depositsPage(q.status, q.page, q.pageSize);
  }

  @Get('audit')
  audit(@ZQuery(adminAuditQuerySchema) q: z.infer<typeof adminAuditQuerySchema>) {
    return this.system.auditPage(q.entityType, q.entityId, q.page, q.pageSize);
  }
}

/** Кейсы, каталог, редкости — только admin. */
@Controller('admin')
@Auth({ roles: ['admin'] })
@RateLimit('admin')
export class AdminContentController {
  constructor(
    private readonly games: GamesService,
    private readonly content: AdminContentService,
  ) {}

  @Get('games/:game/case-categories')
  async categories(@ZParam('game', gameCodeSchema) game: string) {
    return this.content.categories(await this.games.getActive(game));
  }

  @Get('games/:game/cases')
  async cases(@ZParam('game', gameCodeSchema) game: string) {
    return this.content.listCases(await this.games.getActive(game));
  }

  @Post('games/:game/cases')
  @HttpCode(200)
  async createCase(
    @ZParam('game', gameCodeSchema) game: string,
    @ZBody(adminCaseSchema) body: AdminCaseBody,
    @CurrentUser() user: AuthContext,
    @Req() req: FastifyRequest,
  ) {
    const id = await this.content.createCase(
      user.userId,
      await this.games.getActive(game),
      body,
      ip(req),
    );
    return this.content.getCase(id);
  }

  @Get('cases/:id')
  getCase(@ZParam('id', idSchema) id: string) {
    return this.content.getCase(id);
  }

  @Put('games/:game/cases/:id')
  async updateCase(
    @ZParam('game', gameCodeSchema) game: string,
    @ZParam('id', idSchema) id: string,
    @ZBody(adminCaseSchema) body: AdminCaseBody,
    @CurrentUser() user: AuthContext,
    @Req() req: FastifyRequest,
  ) {
    await this.content.updateCase(user.userId, id, await this.games.getActive(game), body, ip(req));
    return this.content.getCase(id);
  }

  @Put('cases/:id/contents')
  async contents(
    @ZParam('id', idSchema) id: string,
    @ZBody(adminCaseContentsSchema) body: AdminCaseContentsBody,
    @CurrentUser() user: AuthContext,
    @Req() req: FastifyRequest,
  ) {
    await this.content.setContents(user.userId, id, body, ip(req));
    return this.content.getCase(id);
  }

  @Get('games/:game/items')
  async items(
    @ZParam('game', gameCodeSchema) game: string,
    @ZQuery(adminItemsQuerySchema) q: AdminItemsQuery,
  ) {
    return this.content.items(await this.games.getActive(game), q);
  }

  @Patch('items/:id')
  async patchItem(
    @ZParam('id', idSchema) id: string,
    @ZBody(adminItemPatchSchema) body: AdminItemPatchBody,
    @CurrentUser() user: AuthContext,
    @Req() req: FastifyRequest,
  ) {
    await this.content.patchItem(user.userId, id, body, ip(req));
    return { ok: true };
  }

  @Post('games/:game/items/bulk-price')
  @HttpCode(200)
  async bulkPrice(
    @ZParam('game', gameCodeSchema) game: string,
    @ZBody(adminBulkPriceSchema) body: AdminBulkPriceBody,
    @CurrentUser() user: AuthContext,
    @Req() req: FastifyRequest,
  ) {
    const updated = await this.content.bulkPrice(
      user.userId,
      await this.games.getActive(game),
      body,
      ip(req),
    );
    return { updated };
  }

  @Get('games/:game/rarities')
  async rarities(@ZParam('game', gameCodeSchema) game: string) {
    return this.content.rarities(await this.games.getActive(game));
  }

  @Patch('rarities/:id')
  async patchRarity(
    @ZParam('id', intIdSchema) id: number,
    @ZBody(adminRarityPatchSchema) body: { name?: string; color?: string; sortOrder?: number },
    @CurrentUser() user: AuthContext,
    @Req() req: FastifyRequest,
  ) {
    await this.content.patchRarity(user.userId, id, body, ip(req));
    return { ok: true };
  }
}

/** Бонусы — только admin. */
@Controller('admin')
@Auth({ roles: ['admin'] })
@RateLimit('admin')
export class AdminBonusesController {
  constructor(
    private readonly games: GamesService,
    private readonly bonuses: AdminBonusesService,
  ) {}

  @Get('games/:game/refs')
  async refs(
    @ZParam('game', gameCodeSchema) game: string,
    @ZQuery(refsQuery) q: z.infer<typeof refsQuery>,
  ) {
    return this.bonuses.refs(await this.games.getActive(game), q.q);
  }

  @Get('games/:game/wheel-prizes')
  async wheel(@ZParam('game', gameCodeSchema) game: string) {
    return this.bonuses.wheelPrizes(await this.games.getActive(game));
  }

  @Post('games/:game/wheel-prizes')
  @HttpCode(200)
  async createPrize(
    @ZParam('game', gameCodeSchema) game: string,
    @ZBody(adminWheelPrizeSchema) body: AdminWheelPrizeBody,
    @CurrentUser() user: AuthContext,
    @Req() req: FastifyRequest,
  ) {
    const g = await this.games.getActive(game);
    await this.bonuses.saveWheelPrize(user.userId, g, null, body, ip(req));
    return this.bonuses.wheelPrizes(g);
  }

  @Put('games/:game/wheel-prizes/:id')
  async updatePrize(
    @ZParam('game', gameCodeSchema) game: string,
    @ZParam('id', idSchema) id: string,
    @ZBody(adminWheelPrizeSchema) body: AdminWheelPrizeBody,
    @CurrentUser() user: AuthContext,
    @Req() req: FastifyRequest,
  ) {
    const g = await this.games.getActive(game);
    await this.bonuses.saveWheelPrize(user.userId, g, id, body, ip(req));
    return this.bonuses.wheelPrizes(g);
  }

  @Get('promo-codes')
  promos() {
    return this.bonuses.promos();
  }

  @Post('promo-codes')
  @HttpCode(200)
  async createPromo(
    @ZBody(adminPromoSchema) body: AdminPromoBody,
    @CurrentUser() user: AuthContext,
    @Req() req: FastifyRequest,
  ) {
    await this.bonuses.savePromo(user.userId, null, body, ip(req));
    return this.bonuses.promos();
  }

  @Put('promo-codes/:id')
  async updatePromo(
    @ZParam('id', idSchema) id: string,
    @ZBody(adminPromoSchema) body: AdminPromoBody,
    @CurrentUser() user: AuthContext,
    @Req() req: FastifyRequest,
  ) {
    await this.bonuses.savePromo(user.userId, id, body, ip(req));
    return this.bonuses.promos();
  }

  @Get('partners')
  partners() {
    return this.bonuses.partnersList();
  }

  @Post('partners')
  @HttpCode(200)
  async createPartner(
    @ZBody(adminPartnerSchema) body: AdminPartnerBody,
    @CurrentUser() user: AuthContext,
    @Req() req: FastifyRequest,
  ) {
    await this.bonuses.savePartner(user.userId, null, body, ip(req));
    return this.bonuses.partnersList();
  }

  @Put('partners/:id')
  async updatePartner(
    @ZParam('id', idSchema) id: string,
    @ZBody(adminPartnerSchema) body: AdminPartnerBody,
    @CurrentUser() user: AuthContext,
    @Req() req: FastifyRequest,
  ) {
    await this.bonuses.savePartner(user.userId, id, body, ip(req));
    return this.bonuses.partnersList();
  }

  @Put('levels')
  async levels(
    @ZBody(adminLevelsSchema) body: AdminLevelsBody,
    @CurrentUser() user: AuthContext,
    @Req() req: FastifyRequest,
  ) {
    await this.bonuses.saveLevels(user.userId, body, ip(req));
    return { ok: true };
  }

  @Get('leaderboards')
  leaderboards() {
    return this.bonuses.leaderboardsList();
  }

  @Put('leaderboards/:id')
  async updateLeaderboard(
    @ZParam('id', idSchema) id: string,
    @ZBody(adminLeaderboardSchema) body: AdminLeaderboardBody,
    @CurrentUser() user: AuthContext,
    @Req() req: FastifyRequest,
  ) {
    await this.bonuses.saveLeaderboard(user.userId, id, body, ip(req));
    return this.bonuses.leaderboardsList();
  }

  @Get('achievements')
  achievements() {
    return this.bonuses.achievementsList();
  }

  @Patch('achievements/:id')
  async updateAchievement(
    @ZParam('id', idSchema) id: string,
    @ZBody(adminAchievementSchema) body: AdminAchievementBody,
    @CurrentUser() user: AuthContext,
    @Req() req: FastifyRequest,
  ) {
    await this.bonuses.saveAchievement(user.userId, id, body, ip(req));
    return this.bonuses.achievementsList();
  }
}
