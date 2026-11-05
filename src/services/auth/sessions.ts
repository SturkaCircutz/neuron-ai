import { config } from '../../config.js';
import type { Db } from '../../db.js';
import { unauthorized } from '../../lib/errors.js';
import { newId, now, randomToken, sha256 } from '../../lib/ids.js';

// A refresh token is `${sessionId}.${secret}`. Each refresh rotates the
// secret; presenting an already used secret ends every session of that user.

export function createSession(db: Db, userId: string) {
  const id = newId();
  const secret = randomToken();
  db.sessions.set(id, {
    id,
    userId,
    tokenHash: sha256(secret),
    usedHashes: [],
    expiresAt: Date.now() + config.refreshTokenTtlSec * 1000,
    revoked: false,
    createdAt: now(),
  });
  return `${id}.${secret}`;
}

function findSession(db: Db, token: string | undefined) {
  const [id, secret] = (token ?? '').split('.');
  const session = id ? db.sessions.get(id) : undefined;
  if (!session || !secret || session.revoked || session.expiresAt < Date.now()) return null;
  return { session, hash: sha256(secret) };
}

export function rotateSession(db: Db, token: string | undefined) {
  const found = findSession(db, token);
  if (!found) throw unauthorized('invalid_refresh_token');
  const { session, hash } = found;
  if (hash !== session.tokenHash) {
    if (session.usedHashes.includes(hash)) {
      revokeAllSessions(db, session.userId);
      throw unauthorized('refresh_token_reused');
    }
    throw unauthorized('invalid_refresh_token');
  }
  const secret = randomToken();
  session.usedHashes.push(hash);
  session.tokenHash = sha256(secret);
  return { userId: session.userId, token: `${session.id}.${secret}` };
}

export function revokeSession(db: Db, token: string | undefined, userId: string) {
  const found = findSession(db, token);
  if (found && found.session.userId === userId) found.session.revoked = true;
}

export function revokeAllSessions(db: Db, userId: string) {
  for (const s of db.sessions.values()) if (s.userId === userId) s.revoked = true;
}
