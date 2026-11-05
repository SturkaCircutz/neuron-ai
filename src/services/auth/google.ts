import { createRemoteJWKSet, jwtVerify } from 'jose';
import { config } from '../../config.js';
import { unauthorized } from '../../lib/errors.js';

const googleJwks = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

export interface GoogleProfile {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
}

export function googleAuthUrl(state: string, codeChallenge: string) {
  const params = new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: config.google.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function exchangeGoogleCode(code: string, codeVerifier: string): Promise<GoogleProfile> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      code_verifier: codeVerifier,
      client_id: config.google.clientId,
      client_secret: config.google.clientSecret,
      redirect_uri: config.google.redirectUri,
      grant_type: 'authorization_code',
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw unauthorized('google_exchange_failed');
  const { id_token: idToken } = (await res.json()) as { id_token?: string };
  if (!idToken) throw unauthorized('google_exchange_failed');

  const { payload } = await jwtVerify(idToken, googleJwks, {
    issuer: ['https://accounts.google.com', 'accounts.google.com'],
    audience: config.google.clientId,
  });
  return {
    sub: payload.sub!,
    email: String(payload.email ?? '').toLowerCase(),
    emailVerified: payload.email_verified === true,
    name: typeof payload.name === 'string' ? payload.name : null,
    picture: typeof payload.picture === 'string' ? payload.picture : null,
  };
}
