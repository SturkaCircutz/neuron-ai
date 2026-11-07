// In-memory tables. Each service only writes its own tables; in a split
// deployment each group below becomes that service's own database.

export type Role = 'user' | 'mod' | 'admin';

// Auth service
export interface User {
  id: string;
  handle: string;
  email: string;
  emailVerified: boolean;
  passwordHash: string | null;
  googleSub: string | null;
  displayName: string;
  bio: string;
  avatarUrl: string | null;
  settings: Record<string, unknown>;
  roles: Role[];
  banned: boolean;
  createdAt: string;
}
export interface Session {
  id: string;
  userId: string;
  tokenHash: string;
  usedHashes: string[];
  expiresAt: number;
  revoked: boolean;
  createdAt: string;
}
export interface EmailCode {
  code: string;
  expiresAt: number;
  attempts: number;
}
export interface ResetToken {
  userId: string;
  expiresAt: number;
}

export function createDb() {
  return {
    users: new Map<string, User>(),
    sessions: new Map<string, Session>(),
    emailCodes: new Map<string, EmailCode>(), // by email
    resetTokens: new Map<string, ResetToken>(), // by token hash
  };
}

export type Db = ReturnType<typeof createDb>;
