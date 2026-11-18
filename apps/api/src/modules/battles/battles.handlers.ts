import { Injectable, type OnModuleInit } from '@nestjs/common';
import { WS_EVENTS, WS_ROOMS } from '@gunraid/shared';
import { RealtimeEmitter } from '../../core/realtime-emitter.js';
import { OutboxProcessor } from '../outbox/outbox.processor.js';
import { BattlesNotifier } from './battles.notifier.js';
import { BattlesService } from './battles.service.js';

interface BattleRef {
  battleId: string;
  round?: number;
}

/** Воркер: показ раундов по расписанию, выдача выигрыша, закрытие лобби по таймауту. */
@Injectable()
export class BattlesHandlers implements OnModuleInit {
  constructor(
    private readonly outbox: OutboxProcessor,
    private readonly battles: BattlesService,
    private readonly notifier: BattlesNotifier,
    private readonly realtime: RealtimeEmitter,
  ) {}

  onModuleInit(): void {
    this.outbox.on('battle.round', async (p) => {
      const { battleId, round } = p as unknown as BattleRef;
      const ev = await this.battles.roundEvent(battleId, round ?? 0);
      if (ev) this.realtime.toRoom(WS_ROOMS.battle(battleId), WS_EVENTS.battleRound, ev);
    });
    this.outbox.on('battle.finalize', async (p) => {
      const res = await this.battles.finalize((p as unknown as BattleRef).battleId);
      if (res) await this.notifier.finished(res);
    });
    this.outbox.on('battle.expire', async (p) => {
      const res = await this.battles.expire((p as unknown as BattleRef).battleId);
      if (res) await this.notifier.cancelled(res);
    });
  }
}
