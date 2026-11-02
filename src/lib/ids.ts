import { createHash, randomBytes, randomUUID } from 'node:crypto';

export const newId = () => randomUUID();
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const sha256 = (value: string) => createHash('sha256').update(value).digest('base64url');
export const now = () => new Date().toISOString();
