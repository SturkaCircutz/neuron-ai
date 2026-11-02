import type { FastifyBaseLogger } from 'fastify';
import type { Db } from './db.js';
import type { EventBus } from './lib/events.js';
import type { PubSub } from './lib/pubsub.js';
import type { Keys } from './services/auth/keys.js';
import type { SearchIndex } from './services/search/searchIndex.js';

export interface Mailer {
  send(to: string, subject: string, text: string): Promise<void> | void;
}

/** Shared dependencies handed to every service. */
export interface Ctx {
  db: Db;
  bus: EventBus;
  pubsub: PubSub;
  keys: Keys;
  mailer: Mailer;
  search: SearchIndex;
  log: FastifyBaseLogger;
}
