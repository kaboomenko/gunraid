import fastifyCookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Env } from './config/env.js';
import { AppModule } from './app.module.js';
import { registerSecurityHooks } from './common/security.hooks.js';
import { RedisIoAdapter } from './modules/realtime/redis-io.adapter.js';

/** Сборка HTTP+WS приложения (используется в main.ts и в интеграционных тестах). */
export async function createApp(
  env: Env,
  options: { logger?: boolean; websockets?: boolean } = {},
): Promise<NestFastifyApplication> {
  const adapter = new FastifyAdapter({
    logger: options.logger === false ? false : { level: env.LOG_LEVEL },
    trustProxy: env.TRUST_PROXY,
    bodyLimit: 1024 * 1024,
    genReqId: () => crypto.randomUUID(),
  });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule.forRoot(env), adapter, {
    logger: options.logger === false ? false : ['error', 'warn', 'log'],
    bufferLogs: false,
    rawBody: true,
  });
  await app.register(fastifyCookie, { secret: env.COOKIE_SECRET });
  await app.register(helmet, { contentSecurityPolicy: false, crossOriginResourcePolicy: false });
  registerSecurityHooks(app.getHttpAdapter().getInstance(), env);
  app.setGlobalPrefix('api/v1');
  if (options.websockets !== false) {
    const io = new RedisIoAdapter(app, env);
    await io.connect();
    app.useWebSocketAdapter(io);
  }
  app.enableShutdownHooks();
  return app;
}
