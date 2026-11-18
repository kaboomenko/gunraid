import { Module } from '@nestjs/common';
import { OutboxProcessor } from '../outbox/outbox.processor.js';
import { FeedHandlers } from './feed.handlers.js';
import { FeedService } from './feed.service.js';

/** Воркер: обработка outbox → лента дропов и счётчики. */
@Module({
  providers: [OutboxProcessor, FeedService, FeedHandlers],
  exports: [OutboxProcessor],
})
export class FeedWorkerModule {}
