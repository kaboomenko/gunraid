import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type { Redis } from 'ioredis';
import type { Server, ServerOptions } from 'socket.io';
import type { Env } from '../../config/env.js';
import { createRedis } from '../../core/redis.js';

/** Socket.IO поверх Redis: события доходят до клиентов любого инстанса API. */
export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor: ReturnType<typeof createAdapter> | null = null;
  private clients: Redis[] = [];

  constructor(
    app: INestApplicationContext,
    private readonly env: Env,
  ) {
    super(app);
  }

  async connect(): Promise<void> {
    const pub = createRedis(this.env, 'io-pub');
    const sub = createRedis(this.env, 'io-sub');
    this.clients = [pub, sub];
    this.adapterConstructor = createAdapter(pub, sub, { key: `${this.env.REDIS_PREFIX}io` });
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    const origins = this.env.CORS_ORIGINS?.split(',').map((s) => s.trim()).filter(Boolean);
    const opts: Partial<ServerOptions> = { ...options, path: '/socket.io', serveClient: false };
    if (origins?.length) opts.cors = { origin: origins, credentials: true };
    const server = super.createIOServer(port, opts as ServerOptions) as Server;
    if (this.adapterConstructor) server.adapter(this.adapterConstructor);
    return server;
  }

  override async close(server: Server): Promise<void> {
    await super.close(server);
    await Promise.all(this.clients.map((c) => c.quit().catch(() => undefined)));
  }
}
