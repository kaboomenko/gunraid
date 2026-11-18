import { z } from 'zod';
import type { ItemDto } from './catalog.js';

export const BATTLE_FORMATS = ['1v1', '1v1v1', '1v1v1v1', '2v2'] as const;
export type BattleFormatCode = (typeof BATTLE_FORMATS)[number];

export const BATTLE_MODES = ['classic', 'crazy'] as const;
export type BattleModeCode = (typeof BATTLE_MODES)[number];

export const BATTLE_STATUSES = ['waiting', 'in_progress', 'finished', 'cancelled'] as const;
export type BattleStatus = (typeof BATTLE_STATUSES)[number];

/** Сколько мест в каждом формате. */
export const BATTLE_FORMAT_SLOTS: Record<BattleFormatCode, number> = {
  '1v1': 2,
  '1v1v1': 3,
  '1v1v1v1': 4,
  '2v2': 4,
};

/** За сколько мс до старта вращения раунда сервер присылает его результат (и API начинает его показывать). */
export const BATTLE_ROUND_LEAD_MS = 1000;
/** Пауза после остановки рулеток до следующего раунда. */
export const BATTLE_ROUND_PAUSE_MS = 1500;

const uuid = z.string().uuid();

export const battleCreateSchema = z
  .object({
    cases: z
      .array(z.object({ caseId: uuid, count: z.number().int().min(1).max(100) }).strict())
      .min(1)
      .max(50),
    format: z.enum(BATTLE_FORMATS),
    mode: z.enum(BATTLE_MODES),
  })
  .strict();
export type BattleCreateBody = z.infer<typeof battleCreateSchema>;

export const battleJoinSchema = z
  .object({ slot: z.number().int().min(0).max(3).optional() })
  .strict();
export type BattleJoinBody = z.infer<typeof battleJoinSchema>;

/** Client seed для ботов генерирует браузер создателя — сервер не может подобрать исход. */
export const battleBotsSchema = z
  .object({
    clientSeed: z
      .string()
      .regex(/^[A-Za-z0-9_-]{8,64}$/)
      .optional(),
  })
  .strict();
export type BattleBotsBody = z.infer<typeof battleBotsSchema>;

export const battleListQuerySchema = z.object({
  status: z.enum(['active', 'finished']).default('active'),
  format: z.enum(BATTLE_FORMATS).optional(),
  mode: z.enum(BATTLE_MODES).optional(),
  minPrice: z.coerce.number().int().min(0).optional(),
  maxPrice: z.coerce.number().int().min(0).optional(),
  mine: z.enum(['1', '0']).optional(),
  page: z.coerce.number().int().min(1).max(500).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});
export type BattleListQuery = z.infer<typeof battleListQuerySchema>;

export interface BattleUserDto {
  id: string;
  shortId: number;
  nickname: string;
  avatarUrl: string | null;
  level: number;
}

export interface BattlePlayerDto {
  slot: number;
  team: number | null;
  user: BattleUserDto | null;
  /** У бота — его ник; user при этом null. */
  bot: { nickname: string; avatarUrl: string | null } | null;
  /** Сумма уже показанных дропов (после завершения — итог). */
  total: number;
  /** null — пока баттл не завершён. */
  isWinner: boolean | null;
  /** Стоимость предметов, доставшихся игроку (после завершения). */
  payout: number;
}

export interface BattleRoundCaseDto {
  round: number;
  caseId: string;
  slug: string;
  name: string;
  imageUrl: string | null;
  accentColor: string;
  price: number;
}

export interface BattleDropDto {
  round: number;
  slot: number;
  item: ItemDto;
  value: number;
  /** Кому достался предмет (после завершения). */
  recipientSlot: number | null;
}

export interface BattleDto {
  id: string;
  game: string;
  format: BattleFormatCode;
  mode: BattleModeCode;
  status: BattleStatus;
  maxPlayers: number;
  entryPrice: number;
  roundsCount: number;
  roundDurationMs: number;
  creatorId: string;
  createdAt: string;
  expiresAt: string;
  /** Старт вращения первого раунда (по часам сервера). */
  startsAt: string | null;
  endsAt: string | null;
  finishedAt: string | null;
  cancelReason: string | null;
  serverSeedHash: string;
  /** Раскрывается после завершения. */
  serverSeed: string | null;
  clientSeed: string | null;
  /** Длина = maxPlayers; null — свободное место. */
  players: Array<BattlePlayerDto | null>;
  rounds: BattleRoundCaseDto[];
  /** Только показанные раунды. */
  drops: BattleDropDto[];
  revealedRounds: number;
  winnerSlots: number[] | null;
  winnerTeam: number | null;
  totalValue: number;
  serverTime: string;
}

export interface BattleListCaseDto {
  caseId: string;
  slug: string;
  name: string;
  imageUrl: string | null;
  accentColor: string;
  price: number;
  count: number;
}

export interface BattleListItemDto {
  id: string;
  game: string;
  format: BattleFormatCode;
  mode: BattleModeCode;
  status: BattleStatus;
  maxPlayers: number;
  entryPrice: number;
  roundsCount: number;
  createdAt: string;
  startsAt: string | null;
  endsAt: string | null;
  players: Array<BattlePlayerDto | null>;
  cases: BattleListCaseDto[];
  /** После завершения — сумма всех дропов. */
  totalValue: number;
  winnerSlots: number[] | null;
}

export interface BattleListDto {
  items: BattleListItemDto[];
  total: number;
  page: number;
  pageSize: number;
}

/** Кейс, доступный для баттлов. */
export interface BattleCaseOptionDto {
  id: string;
  slug: string;
  name: string;
  imageUrl: string | null;
  accentColor: string;
  price: number;
}

export interface BattleConfigDto {
  maxCases: number;
  roundDurationMs: number;
  countdownMs: number;
  allowBots: boolean;
  lobbyTimeoutMinutes: number;
}

/** Событие battle:round — результат раунда и момент старта вращения по часам сервера. */
export interface BattleRoundEventDto {
  battleId: string;
  round: number;
  spinStartAt: string;
  drops: BattleDropDto[];
}

export interface BattleProofDto {
  type: 'battle';
  id: string;
  revealed: boolean;
  serverSeed: string | null;
  serverSeedHash: string;
  clientSeed: string | null;
  slotSeeds: string[];
  format: BattleFormatCode;
  mode: BattleModeCode;
  tiebreakRoll: number | null;
  winnerSlots: number[] | null;
  rounds: Array<{
    round: number;
    caseName: string;
    contents: Array<{ itemId: string; odds: number; name: string; price: number }>;
    drops: Array<{ slot: number; itemId: string; ticket: number; value: number }>;
  }>;
  createdAt: string;
}
