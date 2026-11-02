import { randomInt } from 'node:crypto';
import { config } from '../../config.js';
import type { Db, User } from '../../db.js';
import { newId, now } from '../../lib/ids.js';

export const findUserByHandle = (db: Db, handle: string) => [...db.users.values()].find((u) => u.handle === handle);
export const findUserByEmail = (db: Db, email: string) => [...db.users.values()].find((u) => u.email === email);

export const publicUser = (u: User) => ({
  id: u.id,
  handle: u.handle,
  displayName: u.displayName,
  bio: u.bio,
  avatarUrl: u.avatarUrl,
  createdAt: u.createdAt,
});

export const privateUser = (u: User) => ({
  ...publicUser(u),
  email: u.email,
  emailVerified: u.emailVerified,
  roles: u.roles,
  settings: u.settings,
});

export function authorRef(db: Db, userId: string) {
  const u = db.users.get(userId);
  return u ? { id: u.id, handle: u.handle, displayName: u.displayName, avatarUrl: u.avatarUrl } : null;
}

export function createUser(
  db: Db,
  fields: Pick<User, 'email' | 'handle' | 'displayName' | 'passwordHash' | 'googleSub' | 'emailVerified' | 'avatarUrl'>,
) {
  const user: User = {
    id: newId(),
    ...fields,
    bio: '',
    settings: {},
    roles: config.adminEmails.includes(fields.email) ? ['user', 'admin'] : ['user'],
    banned: false,
    createdAt: now(),
  };
  db.users.set(user.id, user);
  return user;
}

export function uniqueHandle(db: Db, seed: string) {
  let base = seed.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 24);
  if (base.length < 3) base = `user${base}`;
  let handle = base;
  while (findUserByHandle(db, handle)) handle = `${base}${randomInt(1000, 10000)}`;
  return handle;
}
