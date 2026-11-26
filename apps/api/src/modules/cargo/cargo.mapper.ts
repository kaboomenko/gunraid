import type { cargoRounds } from '@gunraid/db';
import type {
  CargoLandReason,
  CargoResultDto,
  CargoRoundDto,
  CargoRoundStatus,
  CargoWinnerDto,
  ItemDto,
} from '@gunraid/shared';

export type RoundRow = typeof cargoRounds.$inferSelect;

/** Раунд груза наружу: снимок шаблона на старте и текущие продажи. Приз — по текущей цене каталога. */
export function toRoundDto(r: RoundRow, prize: ItemDto): CargoRoundDto {
  return {
    id: r.id,
    number: r.number,
    status: r.status,
    seatsTotal: r.seatsTotal,
    seatsSold: r.seatsSold,
    seatPrice: r.seatPrice,
    perUserLimit: r.perUserLimit,
    minLevel: r.minLevel,
    depositWithinDays: r.depositWithinDays,
    minSeatsToLand: r.minSeatsToLand,
    prize,
    serverSeedHash: r.serverSeedHash,
    startedAt: r.startedAt.toISOString(),
    endsAt: r.endsAt.toISOString(),
  };
}

/** Итог завершённого раунда (приземлился, закрыт без победителя, отменён). */
export function toResultDto(
  r: RoundRow,
  templateId: string,
  prize: ItemDto,
  winner: CargoWinnerDto | null,
  refunded: boolean,
): CargoResultDto {
  return {
    roundId: r.id,
    templateId,
    number: r.number,
    status: r.status as Exclude<CargoRoundStatus, 'open'>,
    landReason: (r.landReason as CargoLandReason | null) ?? null,
    seatsSold: r.seatsSold,
    seatsTotal: r.seatsTotal,
    minSeatsToLand: r.minSeatsToLand,
    winningSeat: r.winningSeat,
    winner,
    refunded,
    prize,
    finishedAt: (r.finishedAt ?? new Date()).toISOString(),
  };
}
