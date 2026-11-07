import cookie from '@fastify/cookie';
import Fastify, { type FastifyError } from 'fastify';
import type { Ctx, Mailer } from './context.js';
import { createDb } from './db.js';
import { installGateway } from './gateway/index.js';
import { HttpError } from './lib/errors.js';
import { registerMetrics } from './lib/metrics.js';
import { createKeys } from './services/auth/keys.js';
import { authRoutes } from './services/auth/routes.js';

export interface AppOptions {
  logger?: boolean;
  mailer?: Mailer;
}

export async function buildApp(opts: AppOptions = {}) {
  const app = Fastify({ logger: opts.logger ?? true, bodyLimit: 64 * 1024 });

  const ctx: Ctx = {
    db: createDb(),
    keys: await createKeys(),
    log: app.log,
    mailer: opts.mailer ?? { send: (to, subject, text) => app.log.info({ to, subject, text }, 'email (dev mailer)') },
  };

  await app.register(cookie);

  app.setErrorHandler((err: FastifyError | HttpError, req, reply) => {
    if (err instanceof HttpError) return reply.status(err.statusCode).send({ error: err.code, message: err.message });
    if (err.statusCode && err.statusCode < 500) {
      return reply.status(err.statusCode).send({ error: 'bad_request', message: err.message });
    }
    req.log.error(err);
    return reply.status(500).send({ error: 'internal', message: 'internal server error' });
  });

  app.get('/healthz', async () => ({ status: 'ok' }));
  app.get('/readyz', async () => ({ status: 'ok' }));
  registerMetrics(app, () => ({}));

  await app.register(
    async (api) => {
      installGateway(api, ctx);
      await api.register(authRoutes(ctx));
    },
    { prefix: '/api/v1' },
  );

  // Not merged into `app`: a Fastify instance is thenable, so awaiting it would drop the extra fields.
  return { app, ctx };
}
