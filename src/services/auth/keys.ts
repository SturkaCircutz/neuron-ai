import { createLocalJWKSet, exportJWK, generateKeyPair, jwtVerify, SignJWT, type JWK } from 'jose';
import { config } from '../../config.js';
import type { Role } from '../../db.js';
import type { AuthUser } from '../../gateway/index.js';
import { newId } from '../../lib/ids.js';

const ISSUER = 'neuron-ai-auth';
const AUDIENCE = 'neuron-ai-api';

export interface Keys {
  jwks: { keys: JWK[] };
  sign(user: AuthUser): Promise<string>;
  verify(token: string): Promise<AuthUser>;
}

/** RS256 key pair generated at boot. The gateway only ever sees the public JWKS. */
export async function createKeys(): Promise<Keys> {
  const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
  const kid = newId();
  const jwks = { keys: [{ ...(await exportJWK(publicKey)), kid, alg: 'RS256', use: 'sig' }] };
  const keySet = createLocalJWKSet(jwks);

  return {
    jwks,
    sign: (user) =>
      new SignJWT({ handle: user.handle, roles: user.roles })
        .setProtectedHeader({ alg: 'RS256', kid })
        .setSubject(user.id)
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setIssuedAt()
        .setExpirationTime(`${config.accessTokenTtlSec}s`)
        .sign(privateKey),
    async verify(token) {
      const { payload } = await jwtVerify(token, keySet, { issuer: ISSUER, audience: AUDIENCE });
      return { id: payload.sub!, handle: payload.handle as string, roles: payload.roles as Role[] };
    },
  };
}
