import { randomInt } from 'node:crypto';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';
import { config } from '../../config.js';
import type { Ctx } from '../../context.js';
import type { User } from '../../db.js';
import { currentUser } from '../../gateway/index.js';
import { badRequest, conflict, forbidden, HttpError, notFound, unauthorized } from '../../lib/errors.js';
import { randomToken, sha256 } from '../../lib/ids.js';
import { parse } from '../../lib/validate.js';
import { exchangeGoogleCode, googleAuthUrl } from './google.js';
import { hashPassword, verifyPassword } from './passwords.js';
import { createSession, revokeAllSessions, revokeSession, rotateSession } from './sessions.js';
import { createUser, findUserByEmail, findUserByHandle, privateUser, publicUser, uniqueHandle } from './users.js';

const REFRESH_COOKIE = 'nai_rt';
const PKCE_COOKIE = 'nai_pkce';
const AUTH_PATH = '/api/v1/auth';

const email = z.string().trim().toLowerCase().email().max(254);
const password = z.string().min(8).max(200);
export const handle = z.string().regex(/^[a-z0-9_]{3,30}$/, 'use 3-30 lowercase letters, digits or _');

export function authRoutes(ctx: Ctx): FastifyPluginAsync {
  const { db, keys, mailer } = ctx;
  const cookieBase = { httpOnly: true, secure: config.cookieSecure, sameSite: 'strict' as const, path: AUTH_PATH };

  const startSession = (reply: FastifyReply, user: User) =>
    reply.setCookie(REFRESH_COOKIE, createSession(db, user.id), { ...cookieBase, maxAge: config.refreshTokenTtlSec });

  const accessToken = async (user: User) => ({
    accessToken: await keys.sign(user),
    tokenType: 'Bearer',
    expiresIn: config.accessTokenTtlSec,
  });

  async function sendVerificationCode(to: string) {
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    db.emailCodes.set(to, { code, expiresAt: Date.now() + 15 * 60_000, attempts: 0 });
    await mailer.send(to, 'Your Neuron AI verification code', `Your code is ${code}. It expires in 15 minutes.`);
  }

  return async (app) => {
    // 1
    app.get('/auth/google/start', async (_req, reply) => {
      if (!config.google.clientId) throw new HttpError(503, 'google_not_configured');
      const state = randomToken(16);
      const verifier = randomToken(32);
      // Lax, not Strict: the browser must send it on Google's cross-site redirect back to the callback
      reply.setCookie(PKCE_COOKIE, `${state}.${verifier}`, { ...cookieBase, sameSite: 'lax', path: `${AUTH_PATH}/google`, maxAge: 600 });
      return reply.redirect(googleAuthUrl(state, sha256(verifier)));
    });

    // 2
    app.get('/auth/google/callback', async (req, reply) => {
      const query = parse(z.object({ code: z.string(), state: z.string() }), req.query);
      const [state, verifier] = (req.cookies[PKCE_COOKIE] ?? '').split('.');
      reply.clearCookie(PKCE_COOKIE, { path: `${AUTH_PATH}/google` });
      if (!state || !verifier || state !== query.state) throw badRequest('invalid OAuth state');

      const profile = await exchangeGoogleCode(query.code, verifier);
      let user = [...db.users.values()].find((u) => u.googleSub === profile.sub);
      if (!user && profile.emailVerified) {
        user = findUserByEmail(db, profile.email);
        if (user) {
          user.googleSub = profile.sub;
          user.emailVerified = true;
        }
      }
      user ??= createUser(db, {
        email: profile.email,
        handle: uniqueHandle(db, profile.email.split('@')[0] ?? ''),
        displayName: profile.name ?? profile.email.split('@')[0] ?? 'New user',
        passwordHash: null,
        googleSub: profile.sub,
        emailVerified: profile.emailVerified,
        avatarUrl: profile.picture,
      });
      if (user.banned) throw forbidden('banned');

      startSession(reply, user);
      return reply.redirect(config.appUrl);
    });

    // 3
    app.post('/auth/register', async (req, reply) => {
      const body = parse(
        z.object({ email, password, handle, displayName: z.string().trim().min(1).max(60).optional() }),
        req.body,
      );
      if (findUserByEmail(db, body.email)) throw conflict('email_taken');
      if (findUserByHandle(db, body.handle)) throw conflict('handle_taken');
      const user = createUser(db, {
        email: body.email,
        handle: body.handle,
        displayName: body.displayName ?? body.handle,
        passwordHash: await hashPassword(body.password),
        googleSub: null,
        emailVerified: false,
        avatarUrl: null,
      });
      await sendVerificationCode(user.email);
      return reply.status(201).send(privateUser(user));
    });

    // 4
    app.post('/auth/verify-email', async (req, reply) => {
      const body = parse(z.object({ email, code: z.string().regex(/^\d{6}$/) }), req.body);
      const entry = db.emailCodes.get(body.email);
      const user = findUserByEmail(db, body.email);
      if (!entry || !user || entry.expiresAt < Date.now() || ++entry.attempts > 5) {
        db.emailCodes.delete(body.email);
        throw badRequest('invalid or expired code');
      }
      if (entry.code !== body.code) throw badRequest('invalid or expired code');
      db.emailCodes.delete(body.email);
      user.emailVerified = true;
      return reply.status(204).send();
    });

    // 5
    app.post('/auth/login', async (req, reply) => {
      const body = parse(z.object({ email, password: z.string() }), req.body);
      const user = findUserByEmail(db, body.email);
      if (!user?.passwordHash || !(await verifyPassword(body.password, user.passwordHash))) {
        throw unauthorized('invalid_credentials');
      }
      if (!user.emailVerified) throw forbidden('email_not_verified');
      if (user.banned) throw forbidden('banned');
      startSession(reply, user);
      return { ...(await accessToken(user)), user: privateUser(user) };
    });

    // 6. Always 204 so the endpoint does not reveal which emails exist
    app.post('/auth/password/forgot', async (req, reply) => {
      const body = parse(z.object({ email }), req.body);
      const user = findUserByEmail(db, body.email);
      if (user) {
        const token = randomToken();
        db.resetTokens.set(sha256(token), { userId: user.id, expiresAt: Date.now() + 60 * 60_000 });
        await mailer.send(user.email, 'Reset your Neuron AI password', `${config.appUrl}/reset-password?token=${token}`);
      }
      return reply.status(204).send();
    });

    // 7
    app.post('/auth/password/reset', async (req, reply) => {
      const body = parse(z.object({ token: z.string(), password }), req.body);
      const key = sha256(body.token);
      const entry = db.resetTokens.get(key);
      db.resetTokens.delete(key);
      const user = entry && entry.expiresAt > Date.now() ? db.users.get(entry.userId) : undefined;
      if (!user) throw badRequest('invalid or expired token');
      user.passwordHash = await hashPassword(body.password);
      user.emailVerified = true; // they just proved they read that inbox
      revokeAllSessions(db, user.id);
      return reply.status(204).send();
    });

    // 8
    app.post('/auth/refresh', async (req, reply) => {
      const { userId, token } = rotateSession(db, req.cookies[REFRESH_COOKIE]);
      const user = db.users.get(userId);
      if (!user || user.banned) throw unauthorized('invalid_refresh_token');
      reply.setCookie(REFRESH_COOKIE, token, { ...cookieBase, maxAge: config.refreshTokenTtlSec });
      return accessToken(user);
    });

    // 9
    app.post('/auth/logout', async (req, reply) => {
      const me = currentUser(req);
      revokeSession(db, req.cookies[REFRESH_COOKIE], me.id);
      return reply.clearCookie(REFRESH_COOKIE, { path: AUTH_PATH }).status(204).send();
    });

    // 10
    app.post('/auth/logout-all', async (req, reply) => {
      revokeAllSessions(db, currentUser(req).id);
      return reply.clearCookie(REFRESH_COOKIE, { path: AUTH_PATH }).status(204).send();
    });

    // 11
    app.get('/auth/me', async (req) => {
      const user = db.users.get(currentUser(req).id);
      if (!user) throw notFound('user');
      return privateUser(user);
    });

    // 12
    app.get('/users/:handle', async (req) => {
      const params = parse(z.object({ handle: z.string() }), req.params);
      const user = findUserByHandle(db, params.handle);
      if (!user) throw notFound('user');
      return publicUser(user);
    });

    // 13
    app.patch('/users/me', async (req) => {
      const body = parse(
        z.object({
          displayName: z.string().trim().min(1).max(60).optional(),
          bio: z.string().max(1000).optional(),
          avatarUrl: z.string().url().max(500).nullable().optional(),
          settings: z.record(z.unknown()).optional(),
        }),
        req.body,
      );
      const user = db.users.get(currentUser(req).id);
      if (!user) throw notFound('user');
      Object.assign(user, body);
      return privateUser(user);
    });

    // 59
    app.get('/.well-known/jwks.json', async () => keys.jwks);
  };
}
