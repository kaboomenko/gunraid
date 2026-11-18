import { Module } from '@nestjs/common';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { SiteController } from './site.controller.js';

@Module({ imports: [RealtimeModule], controllers: [SiteController] })
export class SiteModule {}
