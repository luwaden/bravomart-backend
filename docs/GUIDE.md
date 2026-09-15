# BravoMart Backend — The Deep-Dive Guide

This document explains the *why* behind every non-obvious decision in this
codebase. If the README told you *what* to run, this tells you *what's
actually happening* when you run it — written for someone who wants to
understand the backend well enough to extend it confidently, not just copy
it.

## Table of contents

1. [How this codebase is organized](#1-how-this-codebase-is-organized)
2. [The dual-token JWT authentication system](#2-the-dual-token-jwt-authentication-system)
3. [RBAC — role-based access control](#3-rbac--role-based-access-control)
4. [Prisma 7's driver-adapter architecture](#4-prisma-7s-driver-adapter-architecture)
5. [Redis as cache + session store](#5-redis-as-cache--session-store)
6. [Rate limiting with Redis](#6-rate-limiting-with-redis)
7. [The AI product creation endpoint, end to end](#7-the-ai-product-creation-endpoint-end-to-end)
8. [Zod validation and the Express 5 `req.query` gotcha](#8-zod-validation-and-the-express-5-reqquery-gotcha)
9. [Centralized error handling](#9-centralized-error-handling)
10. [TypeScript strict mode choices, explained](#10-typescript-strict-mode-choices-explained)
11. [Common mistakes, consolidated](#11-common-mistakes-consolidated)
12. [Interview-level Q&A](#12-interview-level-qa)

---

## 1. How this codebase is organized

### Concept overview

The backend is split into five layers, and a request always flows through
them in the same direction:

```
routes  →  middlewares  →  controllers  →  services  →  Prisma / Redis / Gemini
```

- **routes/** wire a URL + HTTP method to a chain of middleware and a
  controller. They contain no logic — just "this path, these guards, this handler."
- **middlewares/** run *before* a controller and can short-circuit the
  request (auth failures, validation failures, rate limits) before any
  business logic runs.
- **controllers/** translate HTTP ↔ JavaScript: read `req`, call exactly one
  service function, shape `res`. No database queries, no password checks, no
  token math live here.
- **services/** contain the actual business logic — this is where Prisma
  queries, Redis calls, and the Gemini API call happen.
- **config/**, **utils/**, **types/**, **schemas/** are shared building
  blocks the other four layers depend on.

### Why we need it

The alternative — writing the database query, the validation, and the HTTP
response all inline in one big route handler — works fine for a five-route
toy project. It stops working once you need to: test business logic without
spinning up an HTTP server, reuse the same logic from two different routes,
or let two people work on auth and products simultaneously without touching
the same file. Layering is what makes all three possible.

### Real-world analogy

Think of a restaurant. The **route** is the sign on the door telling you
which entrance to use. The **waiter** (controller) takes your order and
brings you your food — they don't cook anything themselves. The **kitchen**
(service) does the actual cooking — and critically, the kitchen doesn't care
whether the order came from a waiter, a phone-in order, or a delivery app;
it just needs "one burger, medium rare." That's exactly why `aiProduct.service.ts`
knows nothing about Express, `req`, or `res` — it could be called from a CLI
script or a cron job just as easily as from `aiProduct.controller.ts`.

### Common mistakes

- Putting a Prisma query directly in a controller "just this once" — it
  always stops being "just this once."
- A service function that takes `req` as a parameter. The moment a service
  touches `req`, it's no longer reusable outside Express, and you've lost
  the entire point of the layer.
- Skipping the controller layer and calling `res.json()` from inside a
  service. Services return data or throw; only controllers talk HTTP.

### Best practices demonstrated here

- Every controller is one-way: `req` in, one service call, `res` out.
- Every service function has a typed input and a typed return value — you
  can read what a service does from its signature alone.
- Cross-cutting concerns (auth, RBAC, rate limiting, upload parsing,
  validation) are middleware, composed in the route definition, not
  duplicated inside controllers.

---

## 2. The dual-token JWT authentication system

### Concept overview

Instead of one long-lived login token, the app issues **two** tokens on
login:

- an **access token** — a JWT, signed, expires in 15 minutes, sent as
  `Authorization: Bearer <token>` on every protected request, verified
  *without* touching the database (just a signature check).
- a **refresh token** — a JWT, signed with a *different* secret, expires in
  30 days, stored only in an **httpOnly cookie** (JavaScript can never read
  it), and its validity is tracked in **Redis** — meaning it can be revoked
  instantly, unlike the access token.

### Why we need it

A single long-lived token creates an impossible trade-off. Make it
short-lived and users get logged out constantly. Make it long-lived and a
stolen token stays valid for weeks with no way to cut it off remotely. The
dual-token pattern resolves this by giving each token a *different job*:

- The access token optimizes for **speed and scale** — verifying a JWT
  signature takes microseconds and needs zero database or Redis round trips,
  which matters because it happens on literally every request.
- The refresh token optimizes for **control** — it's checked rarely (only
  when the access token expires), so it's fine for that check to hit Redis.
  That Redis check is what makes instant revocation possible: delete the
  Redis entry, and the refresh token is dead immediately, even though its
  JWT signature is still technically valid until its 30-day expiry.

### Real-world analogy

Think of a hotel. The **access token** is your room key card — fast to
scan, works everywhere in the hotel, but deliberately programmed to stop
working in a few hours. The **refresh token** is you at the front desk with
your ID and reservation. Getting a fresh key card requires going back to the
desk, which is slower — but it's also the ONLY place the hotel can say "actually,
this reservation is cancelled, no more key cards for this guest,"
which they can't do once a card is already in your pocket and being scanned
at doors around the building.

### Step-by-step implementation

**Login** (`auth.service.ts` → `token.service.ts::issueTokenPair`):

1. Verify email/username/phone + password.
2. Sign an access token: `{ sub: userId, role, vendorProfileId? }`, 15 min expiry.
3. Generate a random `jti` (JWT ID), sign a refresh token: `{ sub: userId, jti }`, 30 day expiry.
4. SHA-256 hash the raw refresh token (never store it raw).
5. `redis.set('refresh:<userId>:<jti>', tokenHash, 'EX', <ttl>)` — Redis is
   the fast-path source of truth.
6. `INSERT` a row into Postgres `refresh_tokens` (durable audit trail).
7. Send the access token in the JSON response body; set the refresh token as
   an httpOnly cookie scoped to `/api/auth`.

**Using the API** (`middlewares/authenticate.ts`):

1. Read `Authorization: Bearer <token>`.
2. `jwt.verify(token, ACCESS_SECRET)` — no database, no Redis. If it throws
   (bad signature or expired), reject with 401.
3. Attach the decoded payload to `req.user`.

**Refreshing** (`token.service.ts::rotateRefreshToken`, hit when the access
token has expired):

1. Read the refresh cookie, `jwt.verify` it with the *refresh* secret.
2. Look up `redis.get('refresh:<sub>:<jti>')`.
3. **Not found** → either it naturally expired, or someone is replaying an
   already-used token. Can't tell which, so treat both as compromise: revoke
   *every* session for that user, reject with 401.
4. **Found, but hash doesn't match** → integrity failure, same response.
5. **Found and matches** → delete that Redis key immediately (rotation:
   this exact token can never be used again), mark the Postgres row
   revoked, and issue a brand-new access+refresh pair — recursing back into
   step 2–7 of Login.

**Logging out** (`token.service.ts::revokeSession`):

1. `jwt.decode()` (not `verify` — see the code comment on why that's safe
   here) the refresh cookie just to find which Redis key to delete.
2. Delete that Redis key.
3. Mark the matching Postgres row (matched by exact `tokenHash`, which is
   what's actually trustworthy here) as revoked.
4. Clear the cookie.

### Execution flow (a full session, start to finish)

```
POST /auth/login  →  access token (body) + refresh token (httpOnly cookie)
   │
   ├─ next 15 minutes: every request sends the access token → authenticate()
   │                    verifies the signature locally, no DB/Redis hit
   │
   ├─ access token expires → next request gets 401
   │
   ├─ frontend calls POST /auth/refresh (cookie sent automatically by browser)
   │     → Redis lookup → rotation → NEW access token + NEW refresh cookie
   │
   └─ ... repeats every ~15 minutes for up to 30 days, until:
         • the user logs out (session revoked), or
         • a stolen refresh token gets replayed (ALL sessions revoked), or
         • 30 days pass with no activity (Redis key naturally expires)
```

### Common mistakes beginners make

- **Storing the refresh token in `localStorage`.** Anything JavaScript can
  read, an XSS attack can steal. The entire security value of the refresh
  token comes from it being httpOnly — inaccessible to JavaScript, stolen
  or legitimate.
- **One refresh token used forever.** Without rotation, a stolen refresh
  token is valid until it naturally expires — potentially a full month —
  and there's no way to detect it was stolen in the first place, only to
  react after the fact.
- **Verifying a refresh token with the access token's secret** (or vice
  versa). If they shared a secret, a leaked access token would also be a
  valid refresh token, defeating the entire point of having two.
- **bcrypt-hashing the refresh token before storing it**, copying the
  pattern used for passwords. Bcrypt is deliberately slow, which is correct
  for low-entropy, guessable secrets like passwords — but wrong for a
  refresh token, which already has enormous entropy from being a signed
  JWT. Slowing down every single refresh request for no security benefit is
  a real, measurable cost with no corresponding gain.

### Best practices demonstrated here

- Two different secrets for two different token types.
- Refresh tokens are rotated on every use, with reuse treated as a signal of
  compromise, not silently ignored.
- Only a hash of the refresh token is ever persisted — not the raw value.
- The refresh cookie is scoped (`path: '/api/auth'`), `httpOnly`, `sameSite:
  'strict'`, and `secure` in production — every flag doing a specific job,
  not just copied from a tutorial.
- Redis (fast, TTL-based) and Postgres (durable, queryable) are used
  *together*, each for what it's good at, rather than picking one and
  forcing it to do both jobs.

### Interview-level understanding

**Q: Why not just make the access token long-lived and skip the whole
refresh mechanism?**
A: Because verifying a JWT locally means you *cannot* revoke it early — the
only way to end a session before its natural expiry is to have some kind of
server-side state to check, which is exactly what makes it "not truly
stateless" and defeats the reason you wanted a JWT in the first place. The
dual-token pattern keeps the *frequently-checked* token stateless (fast) and
makes only the *rarely-checked* token stateful (revocable).

**Q: What's the actual attack the reuse-detection logic defends against?**
A: An attacker who steals a refresh token (e.g., via a compromised device or
a leaked backup) can use it once. The legitimate user's next natural refresh
attempt will then find their token already consumed/rotated by the attacker,
fail, and — because we can't tell attacker-first from user-first — the
system revokes everything and forces a fresh login for both. It doesn't
prevent the theft, but it bounds the damage to a single use and surfaces it
immediately instead of letting a stolen token quietly work for a month.

**Q: Why hash the refresh token with SHA-256 instead of storing it as
plaintext, if Redis and Postgres are both supposed to be trusted internal
stores?**
A: Defense in depth. "Trusted" stores get compromised in the real world —
misconfigured backups, a leaked Redis snapshot, an internal breach. If the
stored value is a hash, that leak alone doesn't hand out working tokens. It
costs almost nothing (SHA-256 is fast) and removes an entire class of risk.

---

## 3. RBAC — role-based access control

### Concept overview

Every authenticated user has exactly one `role` (`CUSTOMER`, `VENDOR`,
`DISPATCHER`, `ADMIN`, `SUPER_ADMIN`), baked into their access token.
`middlewares/authorize.ts` is a middleware *factory* — you call
`authorize('VENDOR', 'ADMIN')` and get back a middleware that only lets
those two roles through.

### Why we need it

Authentication answers "who are you?" Authorization answers "are you
allowed to do *this*?" — a completely separate question. A logged-in
customer is authenticated, but has no business hitting
`/api/admin/products/ai-create`. Without a separate authorization step,
that check either doesn't happen (a real security hole) or gets copy-pasted
as an `if` statement into every controller that needs it (inconsistent and
easy to forget).

### Real-world analogy

Authentication is showing your badge at the building's front door.
Authorization is whether your badge opens the server room specifically —
you can be a fully legitimate employee (authenticated) and still not have
clearance for that one door (not authorized).

### Step-by-step implementation

```ts
router.post(
  '/products/ai-create',
  authenticate,                          // 1. must have a valid token at all
  authorize('VENDOR', 'ADMIN', 'SUPER_ADMIN'),  // 2. must be one of these roles
  aiCreateRateLimiter,
  upload.single('image'),
  validate({ body: aiCreateProductBodySchema }),
  createProductWithAi,
);
```

`authorize()` runs strictly after `authenticate()` — it only *reads*
`req.user.role`; it never verifies a token itself. If `authenticate` didn't
run first, `req.user` would be `undefined` and `authorize` correctly
rejects with 401 rather than crashing.

### A real naming collision this project had to resolve

The task's spec names this route `/api/admin/products/ai-create` and
describes it as something "an admin" uses. But inspecting the actual
frontend shows the page that calls this is `AdminAiAssistant.jsx` — and
it's rendered as a **vendor's own dashboard** for managing their own shop,
not a page platform staff use. In BravoMart's UI, "Admin" in that name means
"administer *my store*," not "BravoMart employee."

That's why `authorize('VENDOR', 'ADMIN', 'SUPER_ADMIN')` allows three roles,
and why `resolveTargetVendorId()` in `aiProduct.service.ts` treats them
differently: a `VENDOR` token always publishes to their own shop (the
request body's `vendorId`, if present, is ignored — a vendor must never be
able to post into someone else's storefront just by changing an ID), while
`ADMIN`/`SUPER_ADMIN` tokens have no shop of their own and must explicitly
say whose shop they're posting to.

### Common mistakes

- Checking roles with string comparison scattered across controllers
  (`if (req.user.role !== 'admin')`) instead of one shared, testable
  middleware — easy to get the comparison backwards, easy to forget on a
  new route entirely.
- Trusting a role or ID sent in the *request body* over the one embedded in
  the verified token. This project's `vendorId` handling is the clearest
  example of getting this right: a `VENDOR` caller's own `vendorProfileId`
  (from their signed token) always wins over whatever `vendorId` they might
  put in the request body.
- Forgetting that `authorize` needs `authenticate` to run first, and
  putting them in the wrong order in the route definition.

### Best practices demonstrated here

- Role checks read like English at the route definition, not buried in
  controller logic.
- The middleware is a pure function of `req.user.role` — no side effects,
  trivially unit-testable in isolation.
- Business rules that depend on role (like vendor vs. admin ownership
  resolution) live in the service layer, not the middleware — `authorize`
  only answers "is this role allowed to attempt this endpoint at all,"
  never "what should happen for this specific role."

### Interview-level understanding

**Q: Why is role stored in the JWT instead of looked up fresh from the
database on every request?**
A: Speed — that's the whole point of the access token being stateless (see
section 2). The trade-off: if an admin's role changes mid-session, that
change won't take effect until their access token naturally expires (≤15
minutes here) or they log in again. For a role change that needs to apply
*instantly* (e.g., suspending a compromised account), you'd pair this with
`revokeAllUserSessions()` — force the refresh to fail, which forces
re-authentication, which re-reads the current role from the database.

---

## 4. Prisma 7's driver-adapter architecture

### Concept overview

Older Prisma tutorials show `new PrismaClient()` with no arguments. **That
will not work with the version pinned in this project.** Prisma 7's default
generator (`provider = "prisma-client"` in `schema.prisma`) is *Rust-free* —
it no longer ships a compiled query-engine binary that talks to Postgres by
itself. Instead, `PrismaClient` needs an explicit **driver adapter**: a
small package that wraps a real Node.js database driver.

### Why this changed

The old Rust query engine was a compiled binary specific to your OS/CPU
architecture — a real source of pain in Docker builds, serverless cold
starts, and "works on my machine" bugs. The driver-adapter model instead
reuses `pg` (the extremely well-established, pure-JS/native Postgres
driver) for the actual wire protocol, with Prisma layered on top purely for
the schema, migrations, and query-building experience. Fewer moving parts,
smaller deploy artifacts, faster cold starts.

### Step-by-step implementation

**1. The generator, in `prisma/schema.prisma`:**

```prisma
generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}
```

`output` is not optional in Prisma 7 — the generated client is written into
*your own* `src/` tree at the path you choose, not hidden inside
`node_modules/@prisma/client` the way Prisma 5/6 did it.

**2. The CLI config, in `prisma.config.ts`** (a new file Prisma 7
introduced — the old `"prisma"` key in `package.json` is gone):

```ts
import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations', seed: 'tsx prisma/seed.ts' },
  datasource: { url: env('DATABASE_URL') },
});
```

This is what `prisma generate` / `prisma migrate` / `prisma db seed` all
read now. Skip it and those commands don't know where your schema is.

**3. The runtime client, in `src/config/prisma.ts`:**

```ts
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

const adapter = new PrismaPg(env.DATABASE_URL);
export const prisma = new PrismaClient({ adapter });
```

`PrismaPg` wraps `pg` under the hood; you hand it a connection string (or a
`pg.Pool`/`pg.PoolConfig`, both also accepted), and hand *that* adapter to
`PrismaClient`. This is the step tutorials written before mid-2025 won't
show you, because it didn't exist yet.

### Common mistakes

- Writing `new PrismaClient()` with no adapter — it compiles, but every
  query hangs or fails at runtime with a driver error, which is a
  confusing first debugging experience.
- Importing `PrismaClient` from `@prisma/client` out of habit — in this
  project's setup, the real client lives at `src/generated/prisma/client.ts`
  (your own chosen `output` path), not in `node_modules`.
- Forgetting `prisma.config.ts` entirely and wondering why `prisma migrate
  dev` can't find the schema.
- Running `prisma db seed` and expecting it to fire automatically during
  `prisma migrate dev`/`reset` the way older Prisma versions did — Prisma 7
  seeds only when you explicitly run `npm run prisma:seed`.

### Best practices demonstrated here

- `src/config/prisma.ts` is the *only* file in the app that constructs
  `PrismaClient` — every other file imports the already-configured
  singleton, so there's exactly one place that would need to change if the
  adapter or connection strategy ever changed.
- `src/generated/` is gitignored — generated code doesn't belong in version
  control; `npm run prisma:generate` reproduces it deterministically from
  `schema.prisma` on any machine.

---

## 5. Redis as cache + session store

### Concept overview

Redis is used for two distinct jobs in this app, and it's worth being
explicit that they're different:

1. **Session store** (section 2) — refresh token validity, keyed by user+jti.
2. **Cache** (this section) — a copy of Postgres query results, keyed by
   query parameters, so repeat reads skip the database.

### Why we need it (the cache half)

`GET /api/products` is the single most frequently hit endpoint in this API
— every visit to the marketplace grid calls it. Running that Prisma query
(a `findMany` + a `count`, joined against categories and vendors) against
Postgres on every single request works fine at low traffic and becomes the
bottleneck first as traffic grows. Caching the *result* in Redis for a short
window (60 seconds here) means the vast majority of requests are served
without ever reaching Postgres — Redis reads are close to an order of
magnitude faster than a relational query with joins.

### Real-world analogy

The cache is a "specials board" outside a restaurant, chalked up once and
read by every passerby, versus each passerby walking into the kitchen to
ask the chef individually. The chalkboard goes stale — which is exactly why
it has a TTL (see below) — but for the 60 seconds it's accurate, it answers
thousands of people without the kitchen doing any extra work.

### Step-by-step implementation (`services/cache.service.ts`)

The **cache-aside** pattern, in three steps, wrapped as one reusable
function `getOrSetCache`:

```ts
export async function getOrSetCache<T>(key, ttlSeconds, loader) {
  const cached = await redis.get(key);
  if (cached !== null) return JSON.parse(cached);   // HIT — skip Postgres entirely

  const fresh = await loader();                      // MISS — run the real query
  await redis.set(key, JSON.stringify(fresh), 'EX', ttlSeconds);
  return fresh;
}
```

Every product/category read goes through this. The **cache key** encodes
every input that changes the result — `products:list:<category>:<page>:<limit>`
— because two different queries sharing one key would silently serve each
other's wrong, cached data.

### The subtle bug this project's code specifically avoids

Prisma's `Decimal` type (used for `Product.price`) has a `toJSON()` method
that turns it into a **string** when `JSON.stringify`'d. If we cached the
raw Prisma row and only converted `Decimal → number` when *reading* it back
out, we'd get inconsistent behavior: a cache **miss** returns `price` as a
number (fresh from the conversion step), but a cache **hit** returns it as
a string (because `JSON.parse` has no idea it should reconstruct a
`Decimal`, and just gives you back the plain string that was stored).
That's a bug that appears *intermittently*, depending on cache state — one
of the worst kinds to track down. The fix (see `product.service.ts`) is to
run `toProductResponse()` — converting `Decimal → number` — **before**
caching, inside the loader, so the exact same plain-number shape is stored
and retrieved on both hit and miss paths.

### Cache invalidation

When `aiProduct.service.ts::createAiGeneratedProduct` writes a new product,
every previously-cached product *list* page is now potentially stale (a new
item could belong on page 1). `invalidateProductCaches()` clears every key
matching `products:list:*` using Redis's `SCAN` command — never `KEYS`,
which blocks Redis's single-threaded event loop for as long as it takes to
walk the *entire* keyspace. `SCAN` walks the same keyspace incrementally, in
small non-blocking batches, via a cursor — the only safe choice once your
Redis instance holds more than a trivial number of keys.

### Common mistakes

- Caching without a TTL — a cache that never expires isn't a cache, it's a
  second, harder-to-keep-consistent copy of your database.
- Caching before converting types that don't round-trip cleanly through
  JSON (see the `Decimal` example above) — this exact bug is why that
  conversion happens where it does in this codebase.
- Using `KEYS pattern*` for invalidation in anything beyond a toy project.
- Forgetting to invalidate on writes at all — the classic "why am I still
  seeing the old data" bug, always traced back to a write path that updated
  Postgres and never touched the cache.

### Best practices demonstrated here

- One generic `getOrSetCache` helper reused everywhere, instead of
  hand-rolled `redis.get`/`redis.set` pairs scattered across services.
- Cache keys are deterministic functions of their query parameters.
- Type conversion happens before caching, not after retrieval.
- Invalidation uses `SCAN`, never `KEYS`.

---

## 6. Rate limiting with Redis

### Concept overview

`middlewares/rateLimiter.ts` is a small, hand-rolled **fixed-window** rate
limiter — no external rate-limiting library, so the mechanism is visible
rather than hidden inside a package.

### Why we need it

Two specific endpoints in this API are expensive or sensitive enough to
abuse: `/api/auth/login` (credential-stuffing / brute-force attempts) and
`/api/admin/products/ai-create` (every call spends real Gemini API quota —
and money). Without a limiter, either a bug in a client or a malicious actor
can hammer these endpoints with no friction at all.

### How it works internally

```ts
const currentCount = await redis.incr(key);       // atomic increment
if (currentCount === 1) await redis.expire(key, windowSeconds);
if (currentCount > maxRequests) { /* reject with 429 */ }
```

The trick is that Redis's `INCR` is **atomic** — even if two requests from
the same user arrive in the same millisecond, Redis guarantees each gets a
distinct, correctly incremented count back. There's no race where both
requests read "0" and both proceed thinking they're first. Only the request
that just *created* the counter (`currentCount === 1`) sets its expiry — if
every request reset the TTL, a steady stream of traffic would keep pushing
the window forward forever and the limit would never actually reset.

### Common mistakes

- Implementing rate limiting with a plain JavaScript object/`Map` in
  process memory — this breaks the moment you run more than one server
  instance, since each instance has its own, unsynchronized count.
- Re-setting the TTL on every request instead of only on the first request
  in a window — silently turns a "10 requests per 60 seconds" limiter into
  "10 requests since your *last* request more than 60 seconds ago," which
  never actually triggers under sustained load.
- Rate limiting by IP address alone for authenticated routes, which
  over-penalizes everyone behind the same corporate NAT/VPN. This project
  keys by `req.user.sub` when available and only falls back to IP for
  anonymous routes like login.

---

## 7. The AI product creation endpoint, end to end

This is the centerpiece feature, so it gets the full walkthrough.

### Concept overview

`POST /api/admin/products/ai-create` takes a vendor's plain-English product
description (optionally with a photo) and turns it into a fully-formed,
saved product listing — title, SEO-aware description, price, category,
tags, inventory — using Gemini's structured JSON output, so the response is
guaranteed parseable data, not free-form text you'd have to scrape.

### Why we need it

The frontend already had this exact UX mocked out client-side in
`AdminAiAssistant.jsx` — literally a `setTimeout` faking a delay and
returning hardcoded values. Vendors filling out a full product form by hand
(title, SEO description, tags, category) is real friction that stops
listings from going up; letting them type one sentence and a photo instead
is the actual product idea this endpoint makes real.

### Real-world analogy

It's a very good, very fast assistant standing next to the vendor: they say
"vintage brown leather jacket, size L, ₦45,000, genuine cowhide" and hold up
the item, and the assistant hands back a properly formatted store listing —
without inventing details neither the vendor said nor the photo shows.

### Step-by-step implementation, matching the actual middleware chain

```ts
router.post(
  '/products/ai-create',
  authenticate,                                    // must be logged in
  authorize('VENDOR', 'ADMIN', 'SUPER_ADMIN'),       // must be an allowed role
  aiCreateRateLimiter,                               // throttle BEFORE spending Gemini quota
  upload.single('image'),                            // parse the optional photo into req.file
  validate({ body: aiCreateProductBodySchema }),      // check `prompt` (+ `vendorId` for staff)
  createProductWithAi,                                // the controller
);
```

**Inside `createAiGeneratedProduct` (`services/aiProduct.service.ts`):**

1. **`resolveTargetVendorId`** — decide whose shop this listing belongs to
   (see section 3 for the VENDOR-vs-ADMIN reasoning).
2. **`generateListingFromPrompt`** — the actual Gemini call:
   - Build `contents`: the prompt as a text part, plus — if a photo was
     uploaded — an `inlineData` part with the image's base64 bytes and MIME
     type (multer's memory storage means this buffer was never written to
     disk; it's converted to base64 directly from RAM).
   - Call `genAI.models.generateContent({ model: 'gemini-2.5-flash', contents,
     config: { systemInstruction, responseMimeType: 'application/json',
     responseSchema } })`.
   - `responseSchema` (built from the same `PRODUCT_CATEGORIES` constant the
     database seed uses) constrains Gemini's *decoding* so it can only
     produce tokens that keep the output valid JSON matching that exact
     shape — this is what "strict structured output" means; it's not just a
     prompt instruction Gemini might ignore.
   - `response.text` is the JSON string; `JSON.parse` it.
   - **Re-validate with `aiGeneratedListingSchema.safeParse`** — even though
     `responseSchema` already asked Gemini to conform. `responseSchema`
     constrains what Gemini is *supposed* to output; it isn't a contract our
     own process enforces. A model update, an API hiccup, or a genuinely
     malformed response could still hand back JSON that doesn't quite match
     — and that JSON is about to be written to the database. "Never trust
     an upstream service blindly" doesn't stop applying just because the
     upstream is an AI model instead of a browser submitting a form.
3. **`findCategoryByName`** — turn the validated `category` string
   (`"Clothing"`, etc.) into a real `categoryId` foreign key by looking up
   the matching seeded `Category` row.
4. **`persistImageBuffer`** (if a photo was uploaded) — write the buffer to
   `uploads/products/<uuid>.<ext>` and get back a servable URL.
5. **`prisma.product.create(...)`** — write the row, `isAiGenerated: true`.
6. **`invalidateProductCaches()`** — clear cached product-list pages (see
   section 5) so the new listing shows up immediately, not after the
   60-second cache TTL happens to expire.
7. **`toProductResponse()`** — convert `price` from `Decimal` to a plain
   number before it ever reaches the controller (see section 5's Decimal
   discussion).

**Back in the controller:** `sendSuccess(res, 201, product)` — `201
Created`, per the task's requirement, with the saved product as `data`.

### Execution flow, visualized

```
Vendor's phone: types a sentence, attaches a photo, taps "Generate"
        │
        ▼
POST /api/admin/products/ai-create  (multipart/form-data)
        │
   ┌────┴─────────────────────────────────────────────┐
   │ authenticate → authorize → rate-limit → multer     │  (middleware chain)
   │ → validate(prompt)                                  │
   └────┬─────────────────────────────────────────────┘
        ▼
resolveTargetVendorId()  →  "this vendor's own shop id"
        ▼
generateListingFromPrompt()
        │  base64(image) + prompt  →  Gemini (gemini-2.5-flash)
        │  ←  strict JSON matching responseSchema
        ▼
aiGeneratedListingSchema.safeParse()   ← defense-in-depth re-validation
        ▼
findCategoryByName("Clothing")  →  real categoryId
        ▼
persistImageBuffer()  →  /uploads/products/<uuid>.jpg
        ▼
prisma.product.create(...)  →  new row in Postgres
        ▼
invalidateProductCaches()  →  SCAN + DEL every "products:list:*" Redis key
        ▼
201 Created  →  { success: true, data: { ...saved product... } }
```

### Common mistakes beginners make with this kind of feature

- **Trusting `responseSchema` alone and skipping server-side re-validation.**
  Structured output support reduces how often a model deviates from the
  requested shape; it doesn't guarantee it never will, and "it worked in my
  five tests" is not the same guarantee as a schema check on every request.
- **Writing the uploaded image to disk *before* checking authorization/
  validation.** This project's middleware order runs `authenticate` →
  `authorize` → rate limit *before* `upload.single('image')` even parses
  the file — so an unauthorized request never gets far enough to touch the
  filesystem at all.
- **Letting any authenticated user set `vendorId` freely** — without the
  role-based branch in `resolveTargetVendorId`, any vendor could post
  products into a competitor's storefront just by changing one field in
  the request body.
- **Forgetting cache invalidation on the write path** — the new product
  would exist in the database immediately but not appear in `GET
  /api/products` until the list cache's TTL happened to expire on its own.

### Best practices demonstrated here

- Rate limiting sits *before* the expensive/costly step (the Gemini call),
  not after.
- The same `PRODUCT_CATEGORIES` constant drives the Gemini schema, the Zod
  re-validation schema, and the database seed — one source of truth instead
  of three lists that can silently drift out of sync.
- Multer's memory storage means the image buffer is used directly for both
  the Gemini call (as base64) and disk persistence — no redundant temp
  files, no extra I/O.
- The service function (`createAiGeneratedProduct`) has zero knowledge of
  Express — it takes plain typed arguments and returns a plain typed
  result, so it could be called from a background job or a test without an
  HTTP request in sight.

### Interview-level understanding

**Q: What's the actual difference between `responseSchema` and re-validating
with Zod afterward — isn't that redundant?**
A: They operate in different trust domains. `responseSchema` constrains
*Gemini's own decoding process* — it can only be as reliable as Google's
implementation of structured output, which you don't control and can't
inspect. The Zod check runs in *your* process, on *your* data, right before
it touches your database — it's the same "boundary validation" instinct
you'd apply to any external input, and it catches the categories of failure
`responseSchema` can't: a transient API bug, a future model version with
slightly different behavior, or Gemini being unavailable and returning an
error page instead of JSON.

**Q: Why base64-encode the image instead of uploading it somewhere and
sending Gemini a URL?**
A: Gemini's multimodal `inlineData` input is designed for exactly this —
small images sent directly in the request payload, no separate upload step,
no extra network round-trip, no temporary public URL that would need to
exist just for Gemini to fetch it. For very large files you'd reach for
Gemini's separate Files API instead, but for a single product photo well
under the request size limit, inline base64 is both simpler and faster.

---

## 8. Zod validation and the Express 5 `req.query` gotcha

### Concept overview

`middlewares/validate.ts` is a single reusable middleware factory:
`validate({ body, query, params })`, each an optional Zod schema. It parses
the corresponding part of the request and, on failure, forwards a `422`
`AppError` with every validation issue attached.

### The gotcha, and why this project handles body/query differently

`req.body = result.data` works — `req.body` is a plain, writable property
set by `express.json()`. But **Express 5 turned `req.query` into a
read-only getter**, computed on the fly from the URL. Try `req.query =
result.data` and Express throws at runtime: *"Cannot set property query of
#<IncomingMessage> which has only a getter."* This is a genuine, current
(2026) framework change that trips people up coming from Express 4 code or
older tutorials.

The fix here: validated/coerced query and param data is attached to a
**separate namespace**, `req.validated` (declared in `types/express.d.ts`),
instead of overwriting `req.query`/`req.params`. Controllers that need
query data read `req.validated?.query as ProductListQuery` instead of
`req.query`.

### Why coercion matters here specifically

Everything in `req.query` arrives as a string — URL query strings have no
concept of a number type. `?page=2` parses as the string `"2"`. Zod's
`z.coerce.number()` (used in `productListQuerySchema`) explicitly converts
that string to a real number *before* validating it's a positive integer —
without `coerce`, `z.number()` would reject `"2"` outright for not being a
number, even though it obviously represents one.

### Common mistakes

- Assuming `req.query = parsedData` still works on Express 5 because it
  worked on Express 4 — this compiles fine in JavaScript and only fails at
  runtime, so it's easy to ship.
- Forgetting `z.coerce` on numeric query params and being confused why a
  schema that "clearly accepts numbers" rejects every real request.
- Validating in the controller with `schema.parse()` wrapped in a manual
  try/catch, repeated in every controller, instead of one shared middleware.

---

## 9. Centralized error handling

### Concept overview

Every anticipated failure in this app — bad input, missing record, wrong
role, expired token — is thrown as an `AppError(message, statusCode,
details?)`. Exactly one place, `middlewares/errorHandler.ts`, decides how
each error type becomes an HTTP response.

### Why this shape

`AppError` carries an `isOperational` flag (always `true` for errors we
threw on purpose). The error handler's logic is essentially: *"if this is
an `AppError`, we chose this message specifically to be shown to the
client — send it as-is. If it's anything else (a null pointer, a typo, a
library throwing something unexpected), it's a bug, not a planned
response — log the real detail server-side and show the client a generic
message in production."* That split is what stops a stray stack trace or
raw SQL error from ever leaking to a browser.

### Execution flow

```
throw new AppError('Product not found.', 404)
        │
   (bubbles up through the async chain — a controller wrapped in
    asyncHandler forwards it to next(err); on Express 5 this happens
    automatically even without the wrapper)
        │
        ▼
errorHandler(err, req, res, next)
        │
        ├─ err instanceof AppError?          → send { message, statusCode } as-is
        ├─ err instanceof multer.MulterError? → 400, upload-specific message
        ├─ err instanceof Prisma.PrismaClientKnownRequestError (P2002/P2025)?
        │                                      → 409 (duplicate) / 404 (not found)
        └─ anything else                      → log full detail server-side,
                                                  500 + generic message to client
```

### Common mistakes

- Error-handling middleware with the wrong number of parameters. Express
  identifies error handlers purely by **arity** — a function with exactly
  four parameters `(err, req, res, next)` is treated as an error handler,
  even if `next` is never called inside it. Drop that fourth parameter (even
  though it looks unused) and Express silently treats the function as a
  normal middleware it never invokes for errors.
- Sending the real error message to the client in production — an easy
  habit to pick up in development, where seeing the real message speeds up
  debugging, that becomes an information-leak once shipped.
- Forgetting to mount the error handler *last*, after every route and after
  the 404 handler — middleware order is execution order in Express, and an
  error handler mounted before a route that throws simply never sees that
  error.

---

## 10. TypeScript strict mode choices, explained

### What `strict: true` actually turns on

`strict` is a bundle of several flags, not one setting:
`strictNullChecks`, `noImplicitAny`, `strictFunctionTypes`,
`strictBindCallApply`, `strictPropertyInitialization`, `noImplicitThis`,
`alwaysStrict`, and `useUnknownInCatchVariables`. In practice, the one that
shapes this codebase the most is `strictNullChecks` — it's why `User.email`
is typed `string | null` (matching the Prisma schema's optional column)
rather than just `string`, and why code that reads it has to actually
handle the `null` case instead of assuming a value is always there.

### Extra flags enabled beyond the strict bundle

- **`noUncheckedIndexedAccess`** — makes any indexed lookup (`array[i]`,
  `record[key]`) return `T | undefined` instead of just `T`. This is why
  `EXTENSION_BY_MIME[mimeType]` in `upload.service.ts` is followed by `??
  'bin'` — without this flag, TypeScript would happily let you use a
  lookup result that's actually `undefined` at runtime for a MIME type not
  in the map.
- **`noImplicitOverride`** — requires an explicit `override` keyword when a
  subclass method overrides a parent's, catching accidental shadowing.
- **`forceConsistentCasingInFileNames`** — catches import path casing
  mismatches that work on case-insensitive filesystems (most developers'
  laptops) and then break in CI/production on case-sensitive Linux.

### The `.js` import extension quirk

Every relative import in this project's `.ts` files ends in `.js` —
`import { env } from '../config/env.js'` — even though the actual file is
`env.ts`. This looks wrong the first time you see it, but it's required:
`"module": "NodeNext"` makes TypeScript follow Node.js's real ESM module
resolution rules, and Node's ESM resolver needs import specifiers to match
the *emitted* file extension, not the source one. Since `env.ts` compiles
to `env.js`, that's what Node needs to find at runtime — so that's what the
import has to say, even in the `.ts` source. Using `"moduleResolution":
"bundler"` instead would let you skip the extension, but only works when a
bundler (esbuild/Vite) does the actual module resolution at runtime instead
of Node itself — not the case here, where `tsc` compiles straight to
runnable Node output.

---

## 11. Common mistakes, consolidated

A single reference list, pulled from every section above, for a quick
pre-flight check before extending this codebase:

- Storing a refresh token anywhere JavaScript can read it (`localStorage`,
  a non-httpOnly cookie).
- Skipping refresh-token rotation, or rotating without treating a reused
  token as a signal of compromise.
- Mixing up which JWT secret verifies which token type.
- `new PrismaClient()` with no driver adapter (Prisma 7).
- `req.query = parsedData` (Express 5).
- Trusting an AI model's structured output without re-validating it
  server-side before it touches the database.
- Trusting a client-supplied ID (like `vendorId`) over the identity
  embedded in a verified access token.
- Caching a value before converting types that don't round-trip cleanly
  through JSON (Prisma's `Decimal` being the concrete example here).
- `redis.keys('pattern*')` instead of `redis.scan()` for anything beyond a
  handful of keys.
- Rate limiting with in-memory state across multiple server instances.
- An error-handling middleware missing its fourth (`next`) parameter.
- Leaking real error messages/stack traces to clients in production.

---

## 12. Interview-level Q&A

**Q: Walk me through what happens, end to end, from a browser sending an
expired access token to that request eventually succeeding.**
A: The request hits `authenticate`, `jwt.verify` throws on the expired
signature check, and the middleware responds `401`. The frontend catches
that `401`, calls `POST /api/auth/refresh` (the httpOnly cookie is attached
automatically by the browser — no JavaScript involved). The refresh route
verifies the refresh token, checks Redis for a live session matching its
`jti`, rotates it (deletes the old Redis entry, issues a brand-new
access+refresh pair, stores the new one), and returns the new access token.
The frontend retries the original request with the new access token, which
now passes `authenticate` normally.

**Q: If Redis goes down entirely, what breaks and what still works?**
A: Login and refresh break immediately — both depend on Redis to
issue/validate sessions. Already-issued access tokens keep working
completely normally for up to their remaining ≤15-minute lifetime, since
verifying them is a pure signature check with no Redis involved. Product
and category reads degrade rather than break: `getOrSetCache` would fail
the `redis.get`/`redis.set` calls, so — depending on how you'd want to
harden it — you'd want those wrapped to fall through to a live Postgres
query rather than throwing, so the catalog stays browsable even with the
cache layer down. (Note: as shipped, `getOrSetCache` does not currently
catch Redis errors — this is a concrete, worthwhile hardening exercise:
catch the Redis calls specifically and fall through to `loader()` directly
on failure, logging the cache outage rather than failing the request.)

**Q: Why does the AI endpoint invalidate *every* product-list cache key
instead of just inserting the new product into the existing cached pages?**
A: Because a cached "page 1, category=Clothing" result is an ordered,
sliced view (`ORDER BY createdAt DESC LIMIT 20 OFFSET 0`) — a new product
can shift what belongs on every page, not just append to the end of one.
Correctly patching every affected cached page in place would mean
re-deriving pagination logic in the cache layer itself; invalidating and
letting the next request recompute a fresh, correct page is both simpler
and correct by construction. The trade-off is a small window of extra
Postgres load right after a write, which is the right trade for a feature
that isn't called on every request the way reads are.

**Q: The vendor KYC document upload and the AI product photo upload both go
through the same Multer configuration, which only accepts JPEG/PNG/WEBP.
What's the practical limitation of that, and how would you fix it?**
A: KYC documents are realistically often PDFs (scanned ID cards, business
registration certificates), which the current `upload` middleware would
reject outright. The fix is a second, separate Multer instance for the KYC
route with a wider `fileFilter` (adding `application/pdf`) and its own size
limit — kept separate from the image-only instance used by the AI endpoint
specifically because Gemini's `inlineData` image input isn't meant for
PDFs, so those two upload paths have genuinely different constraints, not
just an arbitrarily shared one.
