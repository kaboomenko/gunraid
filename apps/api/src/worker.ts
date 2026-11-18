import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { loadEnv } from './config/env.js';
import { WorkerModule } from './worker.module.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const app = await NestFactory.createApplicationContext(WorkerModule.forRoot(env), {
    logger: ['error', 'warn', 'log'],
  });
  app.enableShutdownHooks();
  new Logger('Worker').log(`worker started (${env.APP_ENV})`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
