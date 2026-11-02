import type { DomainEvent } from './lib/events.js';

// In-memory tables. Each service only writes its own tables; in a split
// deployment each group below becomes that service's own database.

export type Role = 'user' | 'mod' | 'admin';
export type PostType = 'thread' | 'comment';

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

// Thread service
export interface Community {
  id: string;
  slug: string;
  name: string;
  description: string;
  rules: string[];
  tags: string[];
  moderatorIds: string[];
  createdAt: string;
}
export interface Thread {
  id: string;
  communityId: string;
  authorId: string;
  title: string;
  body: string;
  tags: string[];
  paperIds: string[];
  score: number;
  commentCount: number;
  locked: boolean;
  hidden: boolean;
  deleted: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface Comment {
  id: string;
  threadId: string;
  parentId: string | null;
  authorId: string;
  body: string;
  score: number;
  hidden: boolean;
  deleted: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface Vote {
  userId: string;
  targetType: PostType;
  targetId: string;
  value: 1 | -1;
}
export interface Bookmark {
  userId: string;
  threadId: string;
  createdAt: string;
}
export interface Report {
  id: string;
  reporterId: string;
  targetType: PostType | 'user';
  targetId: string;
  reason: string;
  status: 'open' | 'resolved';
  createdAt: string;
}
export interface ModAction {
  id: string;
  moderatorId: string;
  action: 'hide' | 'lock' | 'remove' | 'ban';
  targetType: PostType | 'user';
  targetId: string;
  reason: string;
  createdAt: string;
}

// Paper service
export interface Paper {
  id: string;
  arxivId: string | null;
  doi: string | null;
  url: string;
  title: string | null;
  authors: string[];
  abstract: string | null;
  year: number | null;
  status: 'pending' | 'resolved' | 'failed';
  createdAt: string;
}

// Reputation service
export interface RepEntry {
  userId: string;
  points: number;
  reason: string;
  at: number;
}

// Notification service
export interface Notification {
  id: string;
  userId: string;
  type: 'reply' | 'thread_activity' | 'new_thread';
  actorId: string;
  threadId: string;
  commentId: string | null;
  read: boolean;
  createdAt: string;
}
export type FollowTarget = 'thread' | 'community' | 'user';
export interface Follow {
  userId: string;
  targetType: FollowTarget;
  targetId: string;
  createdAt: string;
}

export function createDb() {
  return {
    users: new Map<string, User>(),
    sessions: new Map<string, Session>(),
    emailCodes: new Map<string, EmailCode>(), // by email
    resetTokens: new Map<string, ResetToken>(), // by token hash

    communities: new Map<string, Community>(),
    memberships: new Set<string>(), // `${communityId}:${userId}`
    threads: new Map<string, Thread>(),
    comments: new Map<string, Comment>(),
    votes: new Map<string, Vote>(), // `${userId}:${targetType}:${targetId}`
    bookmarks: new Map<string, Bookmark>(), // `${userId}:${threadId}`
    reports: new Map<string, Report>(),
    modLog: [] as ModAction[],
    outbox: [] as DomainEvent[],

    papers: new Map<string, Paper>(),

    rep: [] as RepEntry[],

    notifications: new Map<string, Notification>(),
    follows: new Map<string, Follow>(), // `${userId}:${targetType}:${targetId}`
  };
}

export type Db = ReturnType<typeof createDb>;
