import { buildApp } from './app.js';
import { config } from './config.js';

const { app } = await buildApp();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    app.close().then(() => process.exit(0));
  });
}

await app.listen({ port: config.port, host: config.host });
