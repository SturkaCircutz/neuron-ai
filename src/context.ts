import type { FastifyBaseLogger } from 'fastify';
import type { Db } from './db.js';
import type { Keys } from './services/auth/keys.js';

export interface Mailer {
  send(to: string, subject: string, text: string): Promise<void> | void;
}

/** Shared dependencies handed to every service. */
export interface Ctx {
  db: Db;
  keys: Keys;
  mailer: Mailer;
  log: FastifyBaseLogger;
}
