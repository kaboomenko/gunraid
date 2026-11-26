import { Injectable } from '@nestjs/common';
import {
  WS_EVENTS,
  WS_ROOMS,
  type CargoBuyResultDto,
  type CargoResultEventDto,
  type CargoRoundEventDto,
  type CargoSeatsEventDto,
} from '@gunraid/shared';
import { RealtimeEmitter } from '../../core/realtime-emitter.js';
import { CargoService, type CargoLanding, type CargoOpened } from './cargo.service.js';

/**
 * События грузов в Socket.IO — только после коммита транзакции (из API и из воркера).
 * Комната одна на игру (`cargo:{game}`); клиент фильтрует события по templateId / roundId.
 */
@Injectable()
export class CargoNotifier {
  constructor(
    private readonly cargo: CargoService,
    private readonly realtime: RealtimeEmitter,
  ) {}

  /** Покупка: баланс покупателю, число мест всем; если покупка заняла последнее место — итог раунда. */
  async purchased(userId: string, game: string, r: CargoBuyResultDto): Promise<void> {
    this.realtime.balance(userId, r.balance);
    const seats: CargoSeatsEventDto = {
      game,
      templateId: r.templateId,
      roundId: r.roundId,
      seatsSold: r.round.seatsSold,
      seatsTotal: r.round.seatsTotal,
    };
    this.realtime.toRoom(WS_ROOMS.cargo(game), WS_EVENTS.cargoSeats, seats);
    if (r.result) {
      this.finished({
        game,
        templateId: r.templateId,
        slug: r.slug,
        result: r.result,
        next: r.next,
        // Покупка уже зафиксирована: сбой чтения победителя не должен превращать ответ в ошибку —
        // без него только не уйдёт inventory:update (инвентарь обновится при следующем запросе).
        winnerId: await this.cargo.winnerOf(r.roundId).catch(() => null),
        balances: [],
      });
    }
  }

  /** Раунд завершился: итог, следующий раунд, инвентарь победителю, балансы тем, кому вернули гемы. */
  finished(l: CargoLanding): void {
    for (const b of l.balances) this.realtime.balance(b.userId, b.balance);
    const result: CargoResultEventDto = { game: l.game, slug: l.slug, result: l.result };
    this.realtime.toRoom(WS_ROOMS.cargo(l.game), WS_EVENTS.cargoResult, result);
    if (l.next) {
      this.opened({ game: l.game, templateId: l.templateId, slug: l.slug, round: l.next });
    }
    if (l.winnerId) this.realtime.toUser(l.winnerId, WS_EVENTS.inventoryUpdate, {});
  }

  /** Начался новый раунд шаблона. */
  opened(o: CargoOpened): void {
    const ev: CargoRoundEventDto = {
      game: o.game,
      templateId: o.templateId,
      slug: o.slug,
      round: o.round,
    };
    this.realtime.toRoom(WS_ROOMS.cargo(o.game), WS_EVENTS.cargoRound, ev);
  }
}
