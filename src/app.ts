import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyError } from 'fastify';
import { config } from './config.js';
import type { Ctx, Mailer } from './context.js';
import { createDb } from './db.js';
import { installGateway } from './gateway/index.js';
import { HttpError } from './lib/errors.js';
import { createOutboxRelay, EventBus } from './lib/events.js';
import { registerMetrics } from './lib/metrics.js';
import { PubSub } from './lib/pubsub.js';
import { createKeys } from './services/auth/keys.js';
import { authRoutes } from './services/auth/routes.js';
import { registerNotificationConsumer } from './services/notification/consumer.js';
import { notificationRoutes } from './services/notification/routes.js';
import { registerPaperConsumer } from './services/paper/consumer.js';
import { paperRoutes } from './services/paper/routes.js';
import { registerReputationConsumer } from './services/reputation/consumer.js';
import { reputationRoutes } from './services/reputation/routes.js';
import { registerSearchConsumer } from './services/search/consumer.js';
import { searchRoutes } from './services/search/routes.js';
import { SearchIndex } from './services/search/searchIndex.js';
import { communityRoutes } from './services/thread/communities.js';
import { registerThreadConsumer } from './services/thread/consumer.js';
import { moderationRoutes } from './services/thread/moderation.js';
import { threadRoutes } from './services/thread/threads.js';

export interface AppOptions {
  logger?: boolean;
  mailer?: Mailer;
  /** Run the outbox relay on a timer. Tests turn this off and call `flushEvents()`. */
  relay?: boolean;
}

export async function buildApp(opts: AppOptions = {}) {
  const app = Fastify({ logger: opts.logger ?? true, bodyLimit: 64 * 1024 });

  const ctx: Ctx = {
    db: createDb(),
    bus: new EventBus(app.log),
    pubsub: new PubSub(),
    keys: await createKeys(),
    search: new SearchIndex(),
    log: app.log,
    mailer: opts.mailer ?? { send: (to, subject, text) => app.log.info({ to, subject, text }, 'email (dev mailer)') },
  };

  await app.register(cookie);
  await app.register(websocket);

  app.setErrorHandler((err: FastifyError | HttpError, req, reply) => {
    if (err instanceof HttpError) return reply.status(err.statusCode).send({ error: err.code, message: err.message });
    if (err.statusCode && err.statusCode < 500) {
      return reply.status(err.statusCode).send({ error: 'bad_request', message: err.message });
    }
    req.log.error(err);
    return reply.status(500).send({ error: 'internal', message: 'internal server error' });
  });

  const relay = createOutboxRelay(ctx.db, ctx.bus, config.outboxPollMs);

  app.get('/healthz', async () => ({ status: 'ok' }));
  app.get('/readyz', async () => ({ status: 'ok' }));
  registerMetrics(app, () => ({
    outbox_pending: ctx.db.outbox.length,
    websocket_subscribers: ctx.pubsub.subscriberCount,
  }));

  await app.register(
    async (api) => {
      installGateway(api, ctx);
      await api.register(authRoutes(ctx));
      await api.register(communityRoutes(ctx));
      await api.register(threadRoutes(ctx));
      await api.register(moderationRoutes(ctx));
      await api.register(paperRoutes(ctx));
      await api.register(reputationRoutes(ctx));
      await api.register(notificationRoutes(ctx));
      await api.register(searchRoutes(ctx));
    },
    { prefix: '/api/v1' },
  );

  registerThreadConsumer(ctx);
  registerPaperConsumer(ctx);
  registerSearchConsumer(ctx);
  registerReputationConsumer(ctx);
  registerNotificationConsumer(ctx);

  if (opts.relay !== false) relay.start();
  app.addHook('onClose', async () => relay.stop());

  // Not merged into `app`: a Fastify instance is thenable, so awaiting it would drop the extra fields.
  return { app, ctx, flushEvents: relay.flush };
}
