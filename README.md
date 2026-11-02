# neuron-ai
open source discussion board on neuroscience

## Backend

Node.js + TypeScript + Fastify. All 60 endpoints live under `/api/v1`, plus `/healthz`, `/readyz` and `/metrics`.

```bash
npm install
cp .env.example .env   # optional
npm run dev            # http://localhost:3000
npm test               # vitest
```

### Layout

```
src/
  gateway/              JWT check against the JWKS, WebSocket /ws
  services/auth         users, sessions, Google PKCE, JWKS
  services/thread       communities, feeds, threads, comments, votes, bookmarks, uploads, moderation
  services/paper        paper records + paper fetcher worker (arXiv, bioRxiv, Crossref)
  services/reputation   points, levels, leaderboard (reads vote.events)
  services/notification notifications, follows, fan out to sockets
  services/search       search + search indexer worker
  lib/                  outbox relay, event bus, pub/sub, pagination, errors
```

Writes go to the owning service plus an outbox row in the same step; the relay publishes
outbox rows to `thread.events`, `vote.events` and `paper.resolved`, and each worker reads
them in its own consumer group.

### Not wired to real infra yet

Everything runs in one process with in-memory stand-ins, so data is lost on restart:

| Proposal       | Stand-in today                          |
| -------------- | --------------------------------------- |
| TiDB + Drizzle | `src/db.ts` maps                        |
| Kafka          | `EventBus` in `src/lib/events.ts`       |
| Redis pub/sub  | `PubSub` in `src/lib/pubsub.ts`         |
| Meilisearch    | `SearchIndex` in `services/search`      |
| Azure Blob     | `/uploads/sign` returns an HMAC signed URL |
