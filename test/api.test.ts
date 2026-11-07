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
GET /.well-known/jwks.json`
  .trim()
  .split('\n');

let app: Built['app'];
const mail: { to: string; text: string }[] = [];

beforeEach(async () => {
  mail.length = 0;
  ({ app } = await buildApp({ logger: false, mailer: { send: (to, _s, text) => void mail.push({ to, text }) } }));
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
  it('registers the auth endpoints from the endpoint sheet', () => {
    expect(ENDPOINTS).toHaveLength(14);
    for (const line of ENDPOINTS) {
      const [method, path] = line.split(' ') as [string, string];
      expect(app.hasRoute({ method: method as 'GET', url: `/api/v1${path}` }), line).toBe(true);
    }
  });

  it('serves health and metrics', async () => {
    expect((await app.inject('/healthz')).json()).toEqual({ status: 'ok' });
    expect((await app.inject('/metrics')).body).toContain('http_requests_total');
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
