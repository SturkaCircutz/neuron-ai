const env = process.env;
const publicUrl = env.PUBLIC_URL ?? 'http://localhost:3000';

export const config = {
  port: Number(env.PORT ?? 3000),
  host: env.HOST ?? '0.0.0.0',
  publicUrl,
  appUrl: env.APP_URL ?? 'http://localhost:5173',
  cookieSecure: env.NODE_ENV === 'production',
  accessTokenTtlSec: 15 * 60,
  refreshTokenTtlSec: 7 * 24 * 60 * 60,
  adminEmails: (env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
  google: {
    clientId: env.GOOGLE_CLIENT_ID ?? '',
    clientSecret: env.GOOGLE_CLIENT_SECRET ?? '',
    redirectUri: `${publicUrl}/api/v1/auth/google/callback`,
  },
  blob: {
    baseUrl: env.BLOB_BASE_URL ?? 'http://localhost:9000/neuron-ai',
    signingSecret: env.BLOB_SIGNING_SECRET ?? 'dev-only-secret',
    maxBytes: 10 * 1024 * 1024,
    urlTtlSec: 10 * 60,
  },
  paperFetch: env.PAPER_FETCH !== 'off',
  outboxPollMs: 200,
};
