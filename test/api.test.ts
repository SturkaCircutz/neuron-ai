import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

type Built = Awaited<ReturnType<typeof buildApp>>;

const ENDPOINTS = `
GET /auth/google/start
GET /auth/google/callback
POST /auth/register
POST /auth/verify-email
POST /auth/login
POST /auth/password/forgot
POST /auth/password/reset
POST /auth/refresh
POST /auth/logout
POST /auth/logout-all
GET /auth/me
GET /users/:handle
PATCH /users/me
GET /users/:handle/threads
GET /users/:handle/comments
GET /communities
GET /communities/:slug
POST /communities
PATCH /communities/:slug
GET /communities/:slug/tags
PUT /communities/:slug/membership
DELETE /communities/:slug/membership
GET /feed
GET /communities/:slug/threads
GET /threads
POST /threads
GET /threads/:id
PATCH /threads/:id
DELETE /threads/:id
GET /threads/:id/comments
GET /comments/:id/replies
POST /threads/:id/comments
PATCH /comments/:id
DELETE /comments/:id
PUT /votes/:targetType/:targetId
DELETE /votes/:targetType/:targetId
PUT /threads/:id/bookmark
DELETE /threads/:id/bookmark
GET /me/bookmarks
POST /uploads/sign
POST /reports
GET /mod/reports
POST /mod/actions
GET /mod/log
POST /papers/resolve
GET /papers/:id
GET /papers
GET /rep/me
GET /rep/:handle
GET /leaderboard
GET /notifications
GET /notifications/unread-count
POST /notifications/read
GET /follows
PUT /follows/:targetType/:targetId
DELETE /follows/:targetType/:targetId
GET /search
GET /search/suggest
GET /.well-known/jwks.json
GET /ws`
  .trim()
  .split('\n');

let app: Built['app'];
let flushEvents: Built['flushEvents'];
const mail: { to: string; text: string }[] = [];

beforeEach(async () => {
  mail.length = 0;
  ({ app, flushEvents } = await buildApp({ logger: false, relay: false, mailer: { send: (to, _s, text) => void mail.push({ to, text }) } }));
});
afterEach(() => app.close());

async function signUp(email: string, handle: string) {
  const reg = await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { email, handle, password: 'correct horse' } });
  expect(reg.statusCode).toBe(201);
  const code = mail.find((m) => m.to === email)!.text.match(/\d{6}/)![0];
  expect((await app.inject({ method: 'POST', url: '/api/v1/auth/verify-email', payload: { email, code } })).statusCode).toBe(204);
  const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password: 'correct horse' } });
  expect(login.statusCode).toBe(200);
  const refresh = login.cookies.find((c) => c.name === 'nai_rt')!.value;
  return { token: login.json().accessToken as string, refresh, id: login.json().user.id as string };
}

const as = (token: string) => ({ authorization: `Bearer ${token}` });

describe('routes', () => {
  it('registers all 60 endpoints from the endpoint sheet', () => {
    expect(ENDPOINTS).toHaveLength(60);
    for (const line of ENDPOINTS) {
      const [method, path] = line.split(' ') as [string, string];
      expect(app.hasRoute({ method: method as 'GET', url: `/api/v1${path}` }), line).toBe(true);
    }
  });

  it('serves health and metrics', async () => {
    expect((await app.inject('/healthz')).json()).toEqual({ status: 'ok' });
    expect((await app.inject('/metrics')).body).toContain('outbox_pending');
  });
});

describe('auth', () => {
  it('signs in, rotates the refresh token, and ends every session on reuse', async () => {
    const alice = await signUp('alice@neuron.test', 'alice');
    expect((await app.inject({ url: '/api/v1/auth/me', headers: as(alice.token) })).json().handle).toBe('alice');
    expect((await app.inject({ url: '/api/v1/auth/me' })).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/v1/auth/me', headers: as('garbage') })).statusCode).toBe(401);

    const first = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', cookies: { nai_rt: alice.refresh } });
    expect(first.statusCode).toBe(200);
    const rotated = first.cookies.find((c) => c.name === 'nai_rt')!;
    expect(rotated.sameSite).toBe('Strict');

    const reuse = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', cookies: { nai_rt: alice.refresh } });
    expect(reuse.json().error).toBe('refresh_token_reused');
    const after = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', cookies: { nai_rt: rotated.value } });
    expect(after.statusCode).toBe(401);
  });

  it('refuses login before the email is verified', async () => {
    await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { email: 'bob@neuron.test', handle: 'bob', password: 'correct horse' } });
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'bob@neuron.test', password: 'correct horse' } });
    expect(login.json().error).toBe('email_not_verified');
  });
});

describe('posting a reply fans out through the outbox', () => {
  it('updates notifications, search, papers and reputation, and pushes over the socket', async () => {
    const admin = await signUp('admin@neuron.test', 'admin');
    const alice = await signUp('alice@neuron.test', 'alice');
    const bob = await signUp('bob@neuron.test', 'bob');

    const community = await app.inject({
      method: 'POST',
      url: '/api/v1/communities',
      headers: as(admin.token),
      payload: { slug: 'comp-neuro', name: 'Computational Neuroscience', tags: ['spiking'] },
    });
    expect(community.statusCode).toBe(201);
    expect((await app.inject({ method: 'POST', url: '/api/v1/communities', headers: as(alice.token), payload: { slug: 'x', name: 'x' } })).statusCode).toBe(403);

    const thread = await app.inject({
      method: 'POST',
      url: '/api/v1/threads',
      headers: as(alice.token),
      payload: { community: 'comp-neuro', title: 'Surrogate gradients for spiking nets', body: 'See https://arxiv.org/abs/1901.09948v2 and **dendrites**.', tags: ['spiking'] },
    });
    expect(thread.statusCode).toBe(201);
    const threadId = thread.json().id as string;

    const socket = await app.injectWS(`/api/v1/ws?token=${alice.token}`);
    const messages: any[] = [];
    socket.on('message', (data: Buffer) => messages.push(JSON.parse(String(data))));
    await new Promise((r) => setTimeout(r, 20));

    const reply = await app.inject({ method: 'POST', url: `/api/v1/threads/${threadId}/comments`, headers: as(bob.token), payload: { body: 'Nice dendrites result' } });
    expect(reply.statusCode).toBe(201);
    expect((await app.inject({ method: 'PUT', url: `/api/v1/votes/thread/${threadId}`, headers: as(bob.token), payload: { value: 1 } })).json().score).toBe(1);
    expect((await app.inject({ method: 'PUT', url: `/api/v1/votes/thread/${threadId}`, headers: as(alice.token), payload: { value: 1 } })).statusCode).toBe(403);

    await flushEvents();
    await new Promise((r) => setTimeout(r, 20));
    socket.terminate();

    expect((await app.inject({ url: '/api/v1/notifications/unread-count', headers: as(alice.token) })).json().count).toBe(1);
    // vote.events and thread.events are separate topics, so their order is not guaranteed
    expect(messages.map((m) => m.type).sort()).toEqual(['notification', 'ready', 'vote']);

    const search = await app.inject({ url: '/api/v1/search?q=dendr&community=comp-neuro&tag=spiking' });
    expect(search.json().items.map((i: any) => i.type).sort()).toEqual(['comment', 'thread']);
    expect((await app.inject({ url: '/api/v1/search?q=dendrites&community=nope' })).json().items).toHaveLength(0);

    const paperId = (await app.inject({ url: `/api/v1/threads/${threadId}` })).json().paperIds[0];
    expect((await app.inject({ url: `/api/v1/papers/${paperId}` })).json().arxivId).toBe('1901.09948');
    expect((await app.inject({ url: `/api/v1/threads?paperId=${paperId}` })).json().items[0].id).toBe(threadId);

    const rep = (await app.inject({ url: '/api/v1/rep/alice' })).json();
    expect(rep.points).toBe(10);

    // switching to a downvote: -10 for the lost upvote, -2 for the downvote
    await app.inject({ method: 'PUT', url: `/api/v1/votes/thread/${threadId}`, headers: as(bob.token), payload: { value: -1 } });
    await flushEvents();
    expect((await app.inject({ url: '/api/v1/rep/alice' })).json().points).toBe(-2);

    const tree = (await app.inject({ url: `/api/v1/threads/${threadId}/comments` })).json();
    expect(tree.items[0].body).toBe('Nice dendrites result');
  });
});

describe('moderation', () => {
  it('lets mods hide reported threads and blocks everyone else', async () => {
    const admin = await signUp('admin@neuron.test', 'admin');
    const alice = await signUp('alice@neuron.test', 'alice');
    await app.inject({ method: 'POST', url: '/api/v1/communities', headers: as(admin.token), payload: { slug: 'ml', name: 'Machine Learning' } });
    const threadId = (await app.inject({ method: 'POST', url: '/api/v1/threads', headers: as(alice.token), payload: { community: 'ml', title: 'Buy cheap GPUs' } })).json().id;

    const report = await app.inject({ method: 'POST', url: '/api/v1/reports', headers: as(alice.token), payload: { targetType: 'thread', targetId: threadId, reason: 'spam' } });
    expect(report.statusCode).toBe(201);
    expect((await app.inject({ url: '/api/v1/mod/reports', headers: as(alice.token) })).statusCode).toBe(403);
    expect((await app.inject({ url: '/api/v1/mod/reports', headers: as(admin.token) })).json().items).toHaveLength(1);

    const action = await app.inject({
      method: 'POST',
      url: '/api/v1/mod/actions',
      headers: as(admin.token),
      payload: { action: 'hide', targetType: 'thread', targetId: threadId, reason: 'spam', reportId: report.json().id },
    });
    expect(action.statusCode).toBe(201);
    expect((await app.inject({ url: `/api/v1/threads/${threadId}` })).statusCode).toBe(404);
    expect((await app.inject({ url: `/api/v1/threads/${threadId}`, headers: as(admin.token) })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/v1/mod/reports', headers: as(admin.token) })).json().items).toHaveLength(0);
    expect((await app.inject({ url: '/api/v1/mod/log', headers: as(admin.token) })).json().items[0].action).toBe('hide');
  });
});
