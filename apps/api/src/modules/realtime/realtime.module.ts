import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { OnlineService } from './online.service.js';
import { RealtimeGateway } from './realtime.gateway.js';

@Module({
  imports: [AuthModule],
  providers: [RealtimeGateway, OnlineService],
  exports: [OnlineService],
})
export class RealtimeModule {}
