import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { loadEnv } from './config/env.js';
import { createApp } from './bootstrap.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const app = await createApp(env);
  await app.listen({ port: env.PORT, host: env.HOST });
  new Logger('Main').log(`API listening on ${env.HOST}:${env.PORT} (${env.APP_ENV})`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
