import { z } from 'zod';
import {
  CARGO_MAX_SEATS,
  CARGO_ROUND_STATUSES,
  CARGO_SLUG_RE,
  type CargoLandReason,
  type CargoMismatchDto,
  type CargoRoundStatus,
} from './cargo.js';
import { ADRENALINE_LEVELS, type AdrenalineLevel } from './cases.js';
import type { ItemDto } from './catalog.js';
import type { AllSettings } from './settings.js';
import type { WithdrawalDto } from './withdrawals.js';

const uuid = z.string().uuid();
const page = z.coerce.number().int().min(1).max(10_000).default(1);
const pageSize = z.coerce.number().int().min(1).max(100).default(30);
const gems = z.number().int().min(0).max(1_000_000_000);
const hexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/);
const optionalDate = z.string().datetime({ offset: true }).nullable().optional();

export interface AdminPageDto<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

// ---------- Дашборд ----------

export const adminDashboardQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(7),
  game: z
    .string()
    .regex(/^[a-z0-9-]{2,32}$/)
    .optional(),
});
export type AdminDashboardQuery = z.infer<typeof adminDashboardQuerySchema>;

/**
 * Режимы в GGR дашборда. cargo — приземлившиеся раунды грузов: ставки — оплата мест, выплаты — призы платных
 * раундов; призы бесплатных грузов вычитаются из общего GGR, как бесплатные кейсы (D13).
 */
export type AdminMode = 'cases' | 'upgrade' | 'contract' | 'battles' | 'cargo';

export interface AdminModeStatsDto {
  mode: AdminMode;
  count: number;
  wagered: number;
  paid: number;
  ggr: number;
  rtp: number | null;
  targetRtp: number | null;
}

export interface AdminDashboardDto {
  from: string;
  to: string;
  game: string | null;
  users: { total: number; new: number; active: number };
  deposits: { count: number; gems: number; users: number };
  withdrawals: { pending: number; completedCount: number; completedValue: number };
  bonuses: number;
  ggr: number;
  modes: AdminModeStatsDto[];
  reconciliation: { checkedAt: string | null; mismatches: number | null };
}

// ---------- Пользователи ----------

export const adminUsersQuerySchema = z.object({
  q: z.string().trim().max(80).optional(),
  status: z.enum(['active', 'banned']).optional(),
  suspicious: z.enum(['1']).optional(),
  role: z.enum(['user', 'support', 'admin']).optional(),
  page,
  pageSize,
});
export type AdminUsersQuery = z.infer<typeof adminUsersQuerySchema>;

export interface AdminUserRowDto {
  id: string;
  shortId: number;
  nickname: string;
  avatarUrl: string | null;
  role: 'user' | 'support' | 'admin';
  status: 'active' | 'banned';
  isSuspicious: boolean;
  level: number;
  balance: number;
  depositsGems: number;
  createdAt: string;
  lastSeenAt: string | null;
}

export interface AdminLinkedAccountDto {
  id: string;
  shortId: number;
  nickname: string;
  status: 'active' | 'banned';
  isSuspicious: boolean;
  via: 'ip' | 'device';
  value: string;
}

export interface AdminUserDetailDto extends AdminUserRowDto {
  banReason: string | null;
  suspiciousNote: string | null;
  referralCode: string;
  referredBy: { id: string; nickname: string } | null;
  identities: Array<{ provider: string; providerUserId: string; displayName: string | null }>;
  gameProfiles: Array<{ game: string; tradeUrl: string | null; playerId: string | null }>;
  stats: {
    depositsCount: number;
    withdrawalsCount: number;
    withdrawalsValue: number;
    inventoryValue: number;
    ledgerSum: number;
  };
  access: Array<{
    event: string;
    ip: string | null;
    deviceId: string | null;
    userAgent: string | null;
    createdAt: string;
  }>;
  linked: AdminLinkedAccountDto[];
}

export const adminBalanceAdjustSchema = z
  .object({
    amount: z
      .number()
      .int()
      .min(-1_000_000_000)
      .max(1_000_000_000)
      .refine((v) => v !== 0, 'amount must not be zero'),
    reason: z.string().trim().min(5).max(500),
  })
  .strict();
export type AdminBalanceAdjustBody = z.infer<typeof adminBalanceAdjustSchema>;

export const adminBanSchema = z.object({ reason: z.string().trim().min(3).max(500) }).strict();
export type AdminBanBody = z.infer<typeof adminBanSchema>;

export const adminUserPatchSchema = z
  .object({
    isSuspicious: z.boolean().optional(),
    suspiciousNote: z.string().trim().max(500).nullable().optional(),
    role: z.enum(['user', 'support', 'admin']).optional(),
  })
  .strict();
export type AdminUserPatchBody = z.infer<typeof adminUserPatchSchema>;

export interface AdminLedgerRowDto {
  id: number;
  type: string;
  amount: number;
  balanceAfter: number;
  refType: string;
  refId: string | null;
  reason: string | null;
  actorId: string | null;
  createdAt: string;
}

// ---------- Выводы и пополнения ----------

export const adminWithdrawalsQuerySchema = z.object({
  status: z
    .string()
    .regex(/^[a-z_,]{3,200}$/)
    .optional(),
  page,
  pageSize,
});

export interface AdminWithdrawalDto extends WithdrawalDto {
  user: { id: string; shortId: number; nickname: string; isSuspicious: boolean };
  flags: { suspicious?: boolean; newAccount?: boolean; sharedDevice?: boolean };
  operator: { id: string; nickname: string } | null;
}

export const adminDepositsQuerySchema = z.object({
  status: z.enum(['pending', 'succeeded', 'failed', 'cancelled', 'expired']).optional(),
  page,
  pageSize,
});

export interface AdminDepositDto {
  id: string;
  user: { id: string; shortId: number; nickname: string };
  provider: string;
  method: string;
  payCurrency: string;
  payAmount: string;
  gemsAmount: number;
  bonusGems: number;
  status: string;
  createdAt: string;
  completedAt: string | null;
}

// ---------- Настройки и курсы ----------

export interface AdminSettingsDto {
  values: AllSettings;
  defaults: AllSettings;
}

export interface FxRateDto {
  currency: string;
  usdRate: string;
  source: string;
  updatedAt: string;
}

export const fxRateSchema = z
  .object({ usdRate: z.string().regex(/^\d{1,12}(\.\d{1,12})?$/) })
  .strict();

// ---------- Кейсы ----------

export interface AdminCaseCategoryDto {
  id: number;
  code: string;
  name: string;
}

export interface AdminCaseRowDto {
  id: string;
  slug: string;
  name: string;
  imageUrl: string | null;
  accentColor: string;
  price: number;
  kind: 'paid' | 'free';
  categoryId: number;
  categoryCode: string;
  isActive: boolean;
  supplyTotal: number | null;
  supplyUsed: number;
  /** Уровень адреналина, заданный вручную; null — считается по составу. */
  adrenaline: AdrenalineLevel | null;
  minLevel: number | null;
  cooldownSeconds: number | null;
  sortOrder: number;
  rtp: number | null;
  itemsCount: number;
  opened: number;
}

export interface AdminCaseDetailDto extends AdminCaseRowDto {
  description: string | null;
  availableFrom: string | null;
  availableUntil: string | null;
  contents: Array<{ item: ItemDto; odds: number }>;
  revision: { id: string; version: number; createdAt: string } | null;
}

export const adminCaseSchema = z
  .object({
    slug: z.string().regex(/^[a-z0-9-]{2,80}$/),
    name: z.string().trim().min(2).max(80),
    description: z.string().trim().max(500).nullable().optional(),
    imageUrl: z.string().trim().max(500).nullable().optional(),
    accentColor: hexColor,
    price: gems,
    kind: z.enum(['paid', 'free']),
    categoryId: z.number().int().positive(),
    minLevel: z.number().int().min(1).max(1000).nullable().optional(),
    cooldownSeconds: z
      .number()
      .int()
      .min(60)
      .max(30 * 86_400)
      .nullable()
      .optional(),
    supplyTotal: z.number().int().min(1).max(10_000_000).nullable().optional(),
    adrenaline: z.enum(ADRENALINE_LEVELS).nullable().optional(),
    availableFrom: optionalDate,
    availableUntil: optionalDate,
    isActive: z.boolean(),
    sortOrder: z.number().int().min(0).max(100_000),
  })
  .strict();
export type AdminCaseBody = z.infer<typeof adminCaseSchema>;

export const adminCaseContentsSchema = z
  .object({
    contents: z
      .array(z.object({ itemId: uuid, odds: z.number().int().positive() }).strict())
      .min(1)
      .max(300),
  })
  .strict();
export type AdminCaseContentsBody = z.infer<typeof adminCaseContentsSchema>;

// ---------- Грузы ----------

/**
 * Шаблон груза: тело создания и правки (все поля сразу). Приз, места, цена, лимит, длительность, условия и минимум
 * продаж действуют со следующего раунда (снимок в раунде, D18); название, картинка, порядок и активность — сразу.
 */
export const adminCargoSchema = z
  .object({
    slug: z.string().regex(CARGO_SLUG_RE),
    name: z.string().trim().min(2).max(80),
    /** Стандартная картинка — cargoImageUrl(kind) (уменьшенные копии есть), иначе — свой путь как есть. */
    imageUrl: z.string().trim().min(1).max(500),
    /** Активный предмет каталога этой игры (иначе 400 CARGO_PRIZE_INVALID). */
    prizeItemId: uuid,
    seatsTotal: z.number().int().min(2).max(CARGO_MAX_SEATS),
    /** Цена места; 0 — бесплатный груз: лимит всегда 1 место на игрока (perUserLimit заменяется на 1). */
    seatPrice: gems,
    /** Мест на игрока за раунд; null — без лимита. Не больше seatsTotal (проверка на сервере). */
    perUserLimit: z.number().int().min(1).max(CARGO_MAX_SEATS).nullable().optional(),
    durationMinutes: z
      .number()
      .int()
      .min(5)
      .max(30 * 24 * 60),
    /** Условия участия (против мультиаккаунтов): уровень и пополнение за последние N дней; null — без условия. */
    minLevel: z.number().int().min(1).max(1000).nullable().optional(),
    depositWithinDays: z.number().int().min(1).max(3650).nullable().optional(),
    /** Минимум продаж для приземления по таймеру (D36); null — без минимума. Не больше seatsTotal. */
    minSeatsToLand: z.number().int().min(1).max(CARGO_MAX_SEATS).nullable().optional(),
    isActive: z.boolean(),
    sortOrder: z.number().int().min(0).max(100_000),
  })
  .strict();
export type AdminCargoBody = z.infer<typeof adminCargoSchema>;

/** `?archived=1` — вместе с архивными (по умолчанию архивные скрыты, D37). */
export const adminCargoListQuerySchema = z.object({ archived: z.enum(['0', '1']).optional() });
export type AdminCargoListQuery = z.infer<typeof adminCargoListQuerySchema>;

export const adminCargoRoundsQuerySchema = z.object({
  status: z.enum(CARGO_ROUND_STATUSES).optional(),
  page,
  pageSize,
});
export type AdminCargoRoundsQuery = z.infer<typeof adminCargoRoundsQuerySchema>;

export const adminCargoCancelSchema = z
  .object({ reason: z.string().trim().min(5).max(500) })
  .strict();
export type AdminCargoCancelBody = z.infer<typeof adminCargoCancelSchema>;

/**
 * Проблема шаблона (первая подходящая): LANDING_STUCK — раунд open, но распродан или срок вышел больше минуты
 * назад (приземление не проходит: landAttempts и lastLandError в round); PRIZE_INACTIVE — приз выключен в каталоге,
 * PRIZE_GAME — приз другой игры: новый раунд не начнётся (D17); NO_ROUND — груз активен, а открытого раунда нет.
 */
export const ADMIN_CARGO_ISSUES = [
  'LANDING_STUCK',
  'PRIZE_INACTIVE',
  'PRIZE_GAME',
  'NO_ROUND',
] as const;
export type AdminCargoIssue = (typeof ADMIN_CARGO_ISSUES)[number];

/** Текущий (открытый) раунд шаблона. */
export interface AdminCargoRoundSummaryDto {
  id: string;
  number: number;
  status: CargoRoundStatus;
  seatsSold: number;
  seatsTotal: number;
  seatPrice: number;
  /** Оплачено за места раунда (сумма paid). */
  revenue: number;
  /** Сколько разных игроков купили места. */
  participants: number;
  /** Приз раунда (снимок на старте) по текущей цене каталога; prizeValue — его цена на старте раунда. */
  prize: ItemDto;
  prizeValue: number;
  /** prizeValue / revenue — RTP, если раунд приземлится с текущими продажами; null без платных продаж. > 1 — убыток. */
  rtpNow: number | null;
  minSeatsToLand: number | null;
  /** Неудачные попытки приземления и причина последней (без SQL и параметров). */
  landAttempts: number;
  lastLandError: string | null;
  lastLandErrorAt: string | null;
  startedAt: string;
  endsAt: string;
  serverSeedHash: string;
}

export interface AdminCargoRowDto {
  id: string;
  /** Код игры шаблона (для адресов правки `admin/games/{game}/cargo/{id}`). */
  game: string;
  slug: string;
  name: string;
  imageUrl: string;
  isActive: boolean;
  sortOrder: number;
  seatsTotal: number;
  seatPrice: number;
  perUserLimit: number | null;
  durationMinutes: number;
  minLevel: number | null;
  depositWithinDays: number | null;
  minSeatsToLand: number | null;
  /** Приз шаблона (для следующих раундов) — и выключенный в каталоге (тогда issue PRIZE_INACTIVE). */
  prize: ItemDto;
  /** prize.price / (seatPrice × seatsTotal) — RTP при распродаже; null у бесплатного. */
  rtp: number | null;
  /** Открытый раунд; null — его нет. */
  round: AdminCargoRoundSummaryDto | null;
  /** Сколько раундов приземлились с победителем. */
  roundsLanded: number;
  issue: AdminCargoIssue | null;
  /** В архиве (D37): только чтение, slug остаётся занятым. */
  archivedAt: string | null;
}

export interface AdminCargoDetailDto extends AdminCargoRowDto {
  createdAt: string;
  updatedAt: string;
}

/** Строка истории раундов (по номеру, новые первыми). */
export interface AdminCargoRoundRowDto {
  id: string;
  number: number;
  status: CargoRoundStatus;
  seatsSold: number;
  seatsTotal: number;
  seatPrice: number;
  /** Оплачено за места (сумма paid); у отменённых и закрытых по минимуму эти гемы вернулись участникам. */
  revenue: number;
  prize: ItemDto;
  /** Цена приза на старте раунда (снимок). */
  prizeValue: number;
  winner: { id: string; shortId: number; nickname: string } | null;
  winningSeat: number | null;
  /** Отменён / закрыт по минимуму с продажами: место, которое выиграло бы (публично, D33). */
  voidSeat: number | null;
  minSeatsToLand: number | null;
  /** sold_out / deadline / min_seats; у отменённого и открытого — null. */
  landReason: CargoLandReason | null;
  cancelReason: string | null;
  startedAt: string;
  endsAt: string;
  finishedAt: string | null;
  serverSeedHash: string;
}

/** Участник раунда: его места, покупки и сколько он заплатил. */
export interface AdminCargoParticipantDto {
  user: { id: string; shortId: number; nickname: string; avatarUrl: string | null };
  seats: number;
  /** Покупки по порядку мест: [от, до] включительно (соседние покупки не склеиваются). */
  ranges: Array<[number, number]>;
  spent: number;
  firstAt: string;
  /** Гемы за раунд вернулись (отмена или минимум продаж). */
  refunded: boolean;
}

/** Раунд целиком: участники — по числу мест (больше — выше), затем по первой покупке. */
export interface AdminCargoRoundDetailDto extends AdminCargoRoundRowDto {
  templateId: string;
  templateName: string;
  game: string;
  participants: AdminCargoParticipantDto[];
}

/** Сверка грузов с ledger (D39): ok — расхождений нет; до 100 строк. */
export interface AdminCargoReconciliationDto {
  ok: boolean;
  mismatches: CargoMismatchDto[];
  checkedAt: string;
}

// ---------- Каталог ----------

export const adminItemsQuerySchema = z.object({
  q: z.string().trim().max(80).optional(),
  rarity: z
    .string()
    .regex(/^[a-z0-9_-]{1,32}$/)
    .optional(),
  active: z.enum(['1', '0']).optional(),
  page,
  pageSize,
});
export type AdminItemsQuery = z.infer<typeof adminItemsQuerySchema>;

export interface AdminItemDto extends ItemDto {
  marketName: string;
  isActive: boolean;
  inUpgrade: boolean;
  inContract: boolean;
  priceUpdatedAt: string | null;
}

export const adminItemPatchSchema = z
  .object({
    price: gems.optional(),
    isActive: z.boolean().optional(),
    isWithdrawable: z.boolean().optional(),
    inUpgrade: z.boolean().optional(),
    inContract: z.boolean().optional(),
  })
  .strict();
export type AdminItemPatchBody = z.infer<typeof adminItemPatchSchema>;

export const adminBulkPriceSchema = z
  .object({
    mode: z.enum(['percent', 'set']),
    /** percent: изменение в процентах (−90…+1000); set: новая цена в гемах. */
    value: z.number().min(-90).max(1_000_000_000),
    q: z.string().trim().max(80).optional(),
    rarity: z
      .string()
      .regex(/^[a-z0-9_-]{1,32}$/)
      .optional(),
  })
  .strict();
export type AdminBulkPriceBody = z.infer<typeof adminBulkPriceSchema>;

export interface AdminRarityDto {
  id: number;
  code: string;
  name: string;
  color: string;
  sortOrder: number;
}

export const adminRarityPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(40).optional(),
    color: hexColor.optional(),
    sortOrder: z.number().int().min(0).max(1000).optional(),
  })
  .strict();

// ---------- Бонусы ----------

export interface AdminWheelPrizeDto {
  id: string;
  type: 'balance' | 'item' | 'free_case' | 'deposit_bonus' | 'extra_spin';
  amount: number | null;
  itemId: string | null;
  itemName: string | null;
  caseId: string | null;
  caseName: string | null;
  percent: number | null;
  maxAmount: number | null;
  weight: number;
  label: string;
  color: string;
  sortOrder: number;
  isActive: boolean;
}

export const adminWheelPrizeSchema = z
  .object({
    type: z.enum(['balance', 'item', 'free_case', 'deposit_bonus', 'extra_spin']),
    amount: gems.nullable().optional(),
    itemId: uuid.nullable().optional(),
    caseId: uuid.nullable().optional(),
    percent: z.number().min(0.01).max(5).nullable().optional(),
    maxAmount: gems.nullable().optional(),
    weight: z.number().int().min(1).max(1_000_000),
    label: z.string().trim().min(1).max(40),
    color: hexColor,
    sortOrder: z.number().int().min(0).max(1000),
    isActive: z.boolean(),
  })
  .strict();
export type AdminWheelPrizeBody = z.infer<typeof adminWheelPrizeSchema>;

export interface AdminPromoDto {
  id: string;
  code: string;
  type: 'balance' | 'deposit_bonus' | 'free_case' | 'wheel_spin' | 'item';
  amount: number | null;
  percent: number | null;
  maxAmount: number | null;
  caseId: string | null;
  itemId: string | null;
  game: string | null;
  totalLimit: number | null;
  perUserLimit: number;
  activationsCount: number;
  startsAt: string | null;
  expiresAt: string | null;
  minDepositGems: number | null;
  minDepositPeriodDays: number | null;
  newUsersMaxAgeHours: number | null;
  partnerId: string | null;
  partnerName: string | null;
  isActive: boolean;
  createdAt: string;
}

export const adminPromoSchema = z
  .object({
    code: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_-]{3,32}$/),
    type: z.enum(['balance', 'deposit_bonus', 'free_case', 'wheel_spin', 'item']),
    amount: gems.nullable().optional(),
    percent: z.number().min(0.01).max(5).nullable().optional(),
    maxAmount: gems.nullable().optional(),
    caseId: uuid.nullable().optional(),
    itemId: uuid.nullable().optional(),
    game: z
      .string()
      .regex(/^[a-z0-9-]{2,32}$/)
      .nullable()
      .optional(),
    totalLimit: z.number().int().min(1).max(10_000_000).nullable().optional(),
    perUserLimit: z.number().int().min(1).max(1000),
    startsAt: optionalDate,
    expiresAt: optionalDate,
    minDepositGems: gems.nullable().optional(),
    minDepositPeriodDays: z.number().int().min(1).max(3650).nullable().optional(),
    newUsersMaxAgeHours: z.number().int().min(1).max(87_600).nullable().optional(),
    partnerId: uuid.nullable().optional(),
    isActive: z.boolean(),
  })
  .strict();
export type AdminPromoBody = z.infer<typeof adminPromoSchema>;

export interface AdminPartnerDto {
  id: string;
  name: string;
  contacts: string | null;
  note: string | null;
  createdAt: string;
  stats: {
    promoCodes: number;
    activations: number;
    users: number;
    depositors: number;
    depositsGems: number;
  };
}

export const adminPartnerSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    contacts: z.string().trim().max(200).nullable().optional(),
    note: z.string().trim().max(500).nullable().optional(),
  })
  .strict();
export type AdminPartnerBody = z.infer<typeof adminPartnerSchema>;

export const adminLevelsSchema = z
  .object({
    levels: z
      .array(
        z
          .object({
            level: z.number().int().min(1).max(1000),
            xpRequired: z.number().int().min(0).max(1e12),
            reward: z
              .object({
                balance: gems.optional(),
                wheelSpins: z.number().int().min(0).max(100).optional(),
                depositBonus: z
                  .object({ percent: z.number().min(0.01).max(5), maxAmount: gems })
                  .strict()
                  .optional(),
              })
              .strict()
              .nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(1000),
  })
  .strict();
export type AdminLevelsBody = z.infer<typeof adminLevelsSchema>;

export interface AdminLeaderboardDto {
  id: string;
  game: string;
  period: 'day' | 'week';
  prizes: Array<{ from: number; to: number; amount: number }>;
  isActive: boolean;
}

export const adminLeaderboardSchema = z
  .object({
    prizes: z
      .array(
        z
          .object({
            from: z.number().int().min(1).max(1000),
            to: z.number().int().min(1).max(1000),
            amount: gems,
          })
          .strict(),
      )
      .max(50),
    isActive: z.boolean(),
  })
  .strict();
export type AdminLeaderboardBody = z.infer<typeof adminLeaderboardSchema>;

export interface AdminAchievementDto {
  id: string;
  code: string;
  name: string;
  description: string;
  icon: string;
  conditionType: string;
  target: number;
  sortOrder: number;
  isActive: boolean;
}

export const adminAchievementSchema = z
  .object({
    name: z.string().trim().min(2).max(60).optional(),
    description: z.string().trim().min(2).max(200).optional(),
    target: z.number().int().min(1).max(1e12).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();
export type AdminAchievementBody = z.infer<typeof adminAchievementSchema>;

// ---------- Аудит ----------

export const adminAuditQuerySchema = z.object({
  entityType: z
    .string()
    .regex(/^[a-z_.-]{2,40}$/)
    .optional(),
  entityId: z.string().max(80).optional(),
  page,
  pageSize,
});

export interface AdminAuditRowDto {
  id: number;
  actor: { id: string; nickname: string } | null;
  action: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
  ip: string | null;
  createdAt: string;
}
