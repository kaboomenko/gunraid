import { Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
} from '@nestjs/websockets';
import { COOKIES, PUBLIC_ROOM_RE, WS_EVENTS, WS_ROOMS } from '@gunraid/shared';
import type { Server, Socket } from 'socket.io';
import { SessionsService } from '../auth/sessions.service.js';
import { TokensService } from '../auth/tokens.service.js';
import { parseCookieHeader } from './cookies.js';
import { OnlineService } from './online.service.js';

const BROADCAST_INTERVAL_MS = 5_000;

@WebSocketGateway({ path: '/socket.io' })
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(RealtimeGateway.name);
  private timer: NodeJS.Timeout | null = null;

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly online: OnlineService,
    private readonly tokens: TokensService,
    private readonly sessions: SessionsService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.tick(), BROADCAST_INTERVAL_MS);
    this.timer.unref();
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.online.remove().catch(() => undefined);
  }

  async handleConnection(client: Socket): Promise<void> {
    this.online.inc();
    client.emit(WS_EVENTS.timeSync, { serverTime: Date.now() });
    try {
      const cookies = parseCookieHeader(client.handshake.headers.cookie);
      const token = cookies[COOKIES.access];
      if (token) {
        const claims = await this.tokens.verifyAccess(token);
        if (await this.sessions.isActive(claims.sessionId)) {
          client.data.userId = claims.userId;
          await client.join(WS_ROOMS.user(claims.userId));
        }
      }
    } catch {
      // гость или просроченный токен — публичные события всё равно доступны
    }
  }

  handleDisconnect(): void {
    this.online.dec();
  }

  @SubscribeMessage(WS_EVENTS.subscribe)
  async subscribe(@ConnectedSocket() client: Socket, @MessageBody() room: unknown) {
    if (typeof room !== 'string' || !PUBLIC_ROOM_RE.test(room)) return { ok: false };
    await client.join(room);
    return { ok: true };
  }

  @SubscribeMessage(WS_EVENTS.unsubscribe)
  async unsubscribe(@ConnectedSocket() client: Socket, @MessageBody() room: unknown) {
    if (typeof room !== 'string') return { ok: false };
    await client.leave(room);
    return { ok: true };
  }

  @SubscribeMessage(WS_EVENTS.timeSync)
  timeSync() {
    return { serverTime: Date.now() };
  }

  private async tick(): Promise<void> {
    try {
      await this.online.publish();
      const online = await this.online.total();
      // local: каждый инстанс шлёт только своим клиентам, без дублей через Redis.
      this.server?.local.emit(WS_EVENTS.statsUpdate, { online });
    } catch (err) {
      this.logger.warn(`online tick failed: ${(err as Error).message}`);
    }
  }
}
