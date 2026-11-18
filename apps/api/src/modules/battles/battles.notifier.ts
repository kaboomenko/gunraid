import { Injectable } from '@nestjs/common';
import { WS_EVENTS, WS_ROOMS } from '@gunraid/shared';
import { RealtimeEmitter } from '../../core/realtime-emitter.js';
import type { BattleFinalized, BattleMutation } from './battles.service.js';
import { BattlesService } from './battles.service.js';

/** События баттлов в Socket.IO — после коммита транзакции (из API и из воркера). */
@Injectable()
export class BattlesNotifier {
  constructor(
    private readonly battles: BattlesService,
    private readonly realtime: RealtimeEmitter,
  ) {}

  /** Создан, кто-то вошёл, добавлены боты / старт. */
  async changed(m: BattleMutation): Promise<void> {
    for (const b of m.balances) this.realtime.balance(b.userId, b.balance);
    const [item, state] = await Promise.all([
      this.battles.listItem(m.battleId),
      this.battles.get(m.battleId),
    ]);
    if (item) this.realtime.toRoom(WS_ROOMS.battles(m.game), WS_EVENTS.battlesUpsert, item);
    this.realtime.toRoom(WS_ROOMS.battle(m.battleId), WS_EVENTS.battleState, state);
  }

  async cancelled(m: BattleMutation): Promise<void> {
    for (const b of m.balances) this.realtime.balance(b.userId, b.balance);
    this.realtime.toRoom(WS_ROOMS.battles(m.game), WS_EVENTS.battlesRemove, { id: m.battleId });
    this.realtime.toRoom(
      WS_ROOMS.battle(m.battleId),
      WS_EVENTS.battleState,
      await this.battles.get(m.battleId),
    );
  }

  async finished(f: BattleFinalized): Promise<void> {
    const [item, state] = await Promise.all([
      this.battles.listItem(f.battleId),
      this.battles.get(f.battleId),
    ]);
    this.realtime.toRoom(WS_ROOMS.battle(f.battleId), WS_EVENTS.battleFinished, state);
    if (item) this.realtime.toRoom(WS_ROOMS.battles(f.game), WS_EVENTS.battlesUpsert, item);
    for (const userId of f.recipients) this.realtime.toUser(userId, WS_EVENTS.inventoryUpdate, {});
  }
}
