# Lifely API

Node · Express 5 · TypeScript · MongoDB Atlas (Mongoose)

The backend for the [Lifely](../lifely) mobile app, built to §26–§27 of
[the product spec](../lifely_claude_code_product_spec.md). The spec recommends
PostgreSQL and Prisma; this uses MongoDB Atlas and Mongoose instead, which is
the one deliberate departure.

---

## Getting it running

```bash
npm install
cp .env.example .env     # then fill in MONGODB_URI and the two secrets
npm run dev              # http://localhost:4000/api/v1
```

### Getting a MongoDB Atlas connection string

1. Create a free **M0** cluster at [cloud.mongodb.com](https://cloud.mongodb.com).
2. **Database Access** → add a database user, and copy the password.
3. **Network Access** → add your IP. `0.0.0.0/0` works for development but do not
   leave it that way in production.
4. **Database → Connect → Drivers** → copy the `mongodb+srv://…` string.
5. Put it in `.env` as `MONGODB_URI`, replacing `<password>` and adding the
   database name in the path:

```
MONGODB_URI=mongodb+srv://user:pass@cluster0.abcde.mongodb.net/lifely?retryWrites=true&w=majority
```

Generate the two secrets with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

The server validates its whole environment at boot and exits with a readable
message if something is missing, rather than failing later on the first request
that needs it.

### Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Watch mode via tsx |
| `npm run build` | Compile to `dist/` (and rewrite the `@/` path aliases) |
| `npm start` | Run the compiled server |
| `npm test` | 74 unit + integration tests |
| `npm run typecheck` | `tsc --noEmit`, strict |
| `npm run smoke` | Build, boot the compiled server, drive it over HTTP |
| `npm run seed` | Fill a demo account with a fortnight of history |

`npm run seed` creates **demo@lifely.app** / **demo-password-1234**. It writes
through the same services the API uses, so the credit ledger it produces is real
rather than fabricated.

---

## API

Everything is under `/api/v1`. `/health` sits outside it and reports whether the
database is reachable (503 when it is not), so a load balancer can use it.

```http
POST   /auth/register          POST   /auth/login
POST   /auth/refresh           POST   /auth/logout
POST   /auth/change-password

GET    /users/me               PATCH  /users/me
GET    /users/me/export        DELETE /users/me

GET    /tasks                  POST   /tasks
GET    /tasks/:id              PATCH  /tasks/:id           DELETE /tasks/:id
POST   /tasks/:id/complete     POST   /tasks/:id/uncomplete

GET    /habits                 POST   /habits
GET    /habits/:id             PATCH  /habits/:id          DELETE /habits/:id
POST   /habits/:id/complete    POST   /habits/:id/skip     POST   /habits/:id/clear

GET    /goals                  POST   /goals
GET    /goals/:id              PATCH  /goals/:id           DELETE /goals/:id
POST   /goals/:id/progress
POST   /goals/:id/milestones
PATCH  /goals/:id/milestones/:milestoneId
DELETE /goals/:id/milestones/:milestoneId

GET    /activities             POST   /activities
GET    /activities/:id         PATCH  /activities/:id      DELETE /activities/:id

GET    /focus/active           GET    /focus/history
POST   /focus/start            POST   /focus/pause         POST   /focus/resume
POST   /focus/finish           POST   /focus/abandon

GET    /credits/balance        GET    /credits/transactions
POST   /credits/adjust

GET    /rewards                POST   /rewards
PATCH  /rewards/:id            DELETE /rewards/:id
POST   /rewards/:id/redeem

GET    /reflections            POST   /reflections
GET    /reflections/:date      DELETE /reflections/:date

GET    /analytics/today        GET    /analytics/week      GET /analytics/month
GET    /analytics/life-score   GET    /analytics/overview

POST   /ai/summarize-day       POST   /ai/analyze-productivity
POST   /ai/plan-tomorrow       POST   /ai/analyze-habits
POST   /ai/analyze-goals       POST   /ai/chat
GET    /ai/context             GET    /ai/quick-actions
```

Authenticate with `Authorization: Bearer <accessToken>`. Access tokens last 15
minutes; refresh tokens last 30 days, are stored hashed, and rotate on every
use, so a leaked refresh token is single-use.

### Errors

Every failure returns the same shape, with a message written for the person
using the app rather than for a console (§35):

```json
{
  "error": {
    "code": "INSUFFICIENT_CREDITS",
    "message": "You need 460 more credits for this one.",
    "details": { "shortfall": 460 },
    "requestId": "b1f7…"
  }
}
```

`requestId` appears in the logs too, so a support report maps to a log line.

---

## Architecture

```
src/
  config/        env (validated at boot), database, logger
  common/        errors, middleware (auth, validate, rate limit), utils
  domain/        business rules — pure, and the authoritative copy
  modules/       one folder per resource: model, service, routes
  scripts/       seed
```

Each module keeps its routing thin and its logic in a service, so business rules
are testable without HTTP.

### The credit engine

Everything that moves credits goes through `modules/credits/credits.service.ts`.
Nothing else writes to the ledger.

```
Action → CreditService → CreditTransaction → (derived) balance → analytics
```

**No balance is stored anywhere.** It is summed from the ledger on read, so the
two cannot drift apart. That is the single most important property here, and
several things protect it:

- **Every payout carries a stable `sourceRef`** — `task:<id>`,
  `habit:<id>:<date>`, `milestone:<id>`, `redemption:<id>`. A unique partial
  index on `(userId, sourceRef)` makes a second payout a database-level
  impossibility rather than something the application must remember to check.
- **Completion is an atomic claim.** `POST /tasks/:id/complete` flips the status
  with a conditional update, so exactly one caller can win a race. The writes
  that follow are idempotent, which means a retried or duplicated request
  converges on the same single payout — and a request that died halfway repairs
  itself next time it runs.
- **Undo removes the entry.** Un-completing a task, unticking a habit day or
  deleting an activity deletes its ledger row and its timeline row together.
- **Spending is checked inside a transaction**, so two concurrent redemptions
  cannot both see a sufficient balance. Atlas is a replica set, so transactions
  are available; the code degrades to non-transactional writes on a deployment
  that lacks them, where the unique index still holds the line.
- **Indexes are built explicitly at boot.** Not cosmetic: `autoIndex` is off in
  production, and without this step a fresh cluster would serve requests with the
  idempotency guarantee missing. The end-to-end smoke run caught exactly that.

Credit values are decided server-side from the user's own rules and clamped. A
client can propose a value; it cannot mint one.

### Life Score

`domain/lifeScore.ts` is the authoritative implementation (§17) — the mobile app
carries the same rules so it can render instantly, but the server recomputes and
the server wins (§50 rule 5). Analytics builds a window of days from a handful of
grouped aggregations rather than a query per day, so a 30-day view is a few round
trips rather than a hundred.

### The assistant

`modules/ai/ai.service.ts` defines `AIProvider` and ships a deterministic local
implementation. It reads `AIContext` — a small, deliberately shaped summary
(§46), never the raw database. `GET /ai/context` returns exactly what it can see,
so the app can be honest with the user about it.

Pointing this at a hosted model means implementing one interface and changing the
export at the bottom of that file. No route changes.

Guardrails (§47): where data is missing the assistant says so — *"Nothing is
logged for today yet"* — instead of inventing a workout.

---

## Security

- Passwords hashed with bcrypt (12 rounds), and never selected by default.
- Refresh tokens stored as SHA-256 hashes and revoked on logout; changing a
  password ends every other session.
- Login answers identically for a wrong password and an unknown account, so the
  endpoint cannot be used to enumerate who has an account.
- **Ownership is part of the query, not an afterthought.** Every lookup goes
  through `findOwned`, which filters on `userId` in the query itself. Another
  account's document returns 404, not 403 — a 403 would confirm it exists.
- Zod validates and *replaces* body, params and query, so handlers only ever see
  values the schema allowed.
- helmet, CORS allow-list, compression, 1 MB body cap, and rate limiting that is
  tighter on the auth endpoints.
- Logs are structured and redact `authorization`, cookies, passwords and tokens.

---

## Testing

```bash
npm test          # 74 tests
npm run smoke     # end-to-end against the compiled build
```

**Unit** (`src/domain`) — credit tiers, the streak-bonus cap, Life Score
weighting and clamping, streaks over rest days and unscheduled days, goal
progress. No database, so it runs in under a second.

**Integration** (`src/modules`) — the real HTTP surface against a real MongoDB
started as a **single-node replica set**, because that is what Atlas is. That
choice matters: the transactions and unique indexes the credit engine depends on
are genuinely exercised rather than silently skipped.

Covered: registration and login, token rotation and revocation, cross-account
access on every verb, the full task → credits → timeline loop and its undo,
concurrent completions, habit streaks and rest days, milestone payouts,
insufficient-credit refusal, concurrent redemption, one-payment-per-reflection,
focus sessions, untracked gaps, analytics, the assistant's guardrails, and
account export and deletion.

`npm run smoke` compiles the project, boots `dist/index.js` as a real process
against a real MongoDB, and drives it over HTTP — the check that the build
output works, not just the source.

> Vitest rather than Jest: the MongoDB 7 driver builds its handshake metadata
> through an async dynamic import that Jest's module sandbox cannot resolve,
> which makes every connection fail there.

---

## Deploying

Any Node host (Render, Railway, Fly, a container) works.

1. `npm ci && npm run build`
2. Start with `npm start`.
3. Set every variable from `.env.example`. `NODE_ENV=production` switches logs to
   JSON and hides stack traces from responses.
4. Allow-list the host's outbound IPs in Atlas → Network Access.
5. Point `CORS_ORIGINS` at your app's origins rather than leaving it `*`.
6. `trust proxy` is already set, so rate limiting sees the real client IP behind
   a proxy.
7. Health check: `GET /health`.

---

## Connecting the mobile app

The app in [`../lifely`](../lifely) is local-first and does not call this yet.
Wiring it up means adding an API client and replacing the Zustand store's action
bodies with requests — the store already funnels every write through action
creators, and the types in `src/types` match these responses, so no screen needs
to change.

Two things to keep in mind when you do:

- The server is the authority on credits and Life Score. Let the app show its
  optimistic number, then reconcile with the `balance` every mutating response
  returns.
- Keep the offline queue. These endpoints are idempotent by design precisely so
  a queued action can be replayed safely after a reconnect.
