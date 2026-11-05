import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Ctx } from '../context.js';
import type { Role } from '../db.js';
import { forbidden, unauthorized } from '../lib/errors.js';

export interface AuthUser {
  id: string;
  handle: string;
  roles: Role[];
}

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthUser | null;
  }
}

/**
 * Gateway concerns, installed on the /api/v1 scope: verify the bearer JWT
 * against the auth service's JWKS, and hold the user's WebSockets.
 */
export function installGateway(api: FastifyInstance, ctx: Ctx) {
  api.decorateRequest('user', null);

  api.addHook('onRequest', async (req) => {
    const header = req.headers.authorization;
    if (!header) return;
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) throw unauthorized('invalid_authorization_header');
    try {
      req.user = await ctx.keys.verify(token);
    } catch {
      throw unauthorized('invalid_token');
    }
  });

  // 60. Browsers cannot set headers on a WebSocket, so the access token comes as ?token=
  api.get('/ws', { websocket: true }, (socket, req) => {
    const { token } = req.query as { token?: string };
    ctx.keys.verify(token ?? '').then(
      (user) => {
        if (socket.readyState !== socket.OPEN) return;
        const unsubscribe = ctx.pubsub.subscribe(`user:${user.id}`, (message) => socket.send(JSON.stringify(message)));
        socket.on('close', unsubscribe);
        socket.send(JSON.stringify({ type: 'ready' }));
      },
      () => socket.close(4401, 'unauthorized'),
    );
  });
}

export function currentUser(req: FastifyRequest): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}

export function assertRole(user: AuthUser, ...roles: Role[]) {
  if (!user.roles.some((r) => roles.includes(r))) throw forbidden();
}
