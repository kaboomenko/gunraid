import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { users, type Db } from '@gunraid/db';
import type { DropSource, FeedDropDto } from '@gunraid/shared';
import { eq } from 'drizzle-orm';
import { DB } from '../../core/tokens.js';
import { OutboxProcessor } from '../outbox/outbox.processor.js';
import { SettingsService } from '../settings/settings.service.js';
import { FeedService } from './feed.service.js';

export interface DropEventPayload {
  game: string;
  source: DropSource;
  userId: string;
  caseSlug?: string | null;
  caseName?: string | null;
  caseImage?: string | null;
  drops: Array<{
    id: string;
    itemId: string;
    skinName: string;
    modelName: string | null;
    imageUrl: string | null;
    rarityColor: string;
    price: number;
  }>;
  createdAt: string;
}

/** Обработчики outbox в воркере: лента дропов и счётчик открытых кейсов. */
@Injectable()
export class FeedHandlers implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly outbox: OutboxProcessor,
    private readonly feed: FeedService,
    private readonly settings: SettingsService,
  ) {}

  onModuleInit(): void {
    this.outbox.on('case.opened', async (p) => {
      const payload = p as unknown as DropEventPayload;
      await this.feed.incrementCasesOpened(payload.drops.length);
      await this.publishDrops(payload);
    });
    this.outbox.on('drop.created', async (p) =>
      this.publishDrops(p as unknown as DropEventPayload),
    );
  }

  private async publishDrops(payload: DropEventPayload): Promise<void> {
    const { minValueGems } = await this.settings.get('feed');
    const [user] = await this.db
      .select({ shortId: users.shortId, nickname: users.nickname, avatarUrl: users.avatarUrl })
      .from(users)
      .where(eq(users.id, payload.userId));
    if (!user) return;
    for (const d of payload.drops) {
      if (d.price < minValueGems) continue;
      const drop: FeedDropDto = {
        id: d.id,
        game: payload.game,
        source: payload.source,
        user,
        item: {
          id: d.itemId,
          skinName: d.skinName,
          modelName: d.modelName,
          imageUrl: d.imageUrl,
          rarityColor: d.rarityColor,
          price: d.price,
        },
        caseSlug: payload.caseSlug ?? null,
        caseName: payload.caseName ?? null,
        caseImage: payload.caseImage ?? null,
        createdAt: payload.createdAt,
      };
      await this.feed.publish(drop);
    }
  }
}
