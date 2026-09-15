# BravoMart Backend

Production-grade Express + TypeScript backend for the BravoMart marketplace
frontend — PostgreSQL via Prisma 7, Redis sessions/caching via ioredis, dual
JWT access/refresh authentication, and an AI-powered product listing
generator built on Google's Gemini (`@google/genai`).

**New to any of the concepts here?** Read [`docs/GUIDE.md`](docs/GUIDE.md) —
it explains every architectural decision in this project from first
principles: what it is, why it exists, how it works internally, and the
mistakes beginners typically make with it. This README is the fast,
practical reference; the guide is the deep one.

---

## Tech stack

| Layer                | Choice                                              |
| --------------------- | ---------------------------------------------------- |
| Runtime / language     | Node.js 20+, TypeScript 7 (strict mode)               |
| Web framework          | Express 5                                              |
| Database                | PostgreSQL, via Prisma 7 (driver-adapter architecture) |
| Cache / session store   | Redis, via ioredis                                     |
| AI                       | `@google/genai`, model `gemini-2.5-flash`, strict JSON schema output |
| File uploads             | Multer (memory storage)                                |
| Auth                     | JWT dual-token (short-lived access + rotating refresh), Redis + httpOnly cookie |
| Validation                | Zod 4                                                   |

---

## File tree

```
bravomart-backend/
├── prisma/
│   ├── schema.prisma          # User, VendorProfile, RefreshToken, Category, Product
│   └── seed.ts                 # seeds categories + a super admin + a demo vendor
├── src/
│   ├── config/
│   │   ├── env.ts               # Zod-validated environment variables
│   │   ├── prisma.ts            # PrismaClient + @prisma/adapter-pg wiring
│   │   ├── redis.ts             # ioredis client
│   │   └── genai.ts             # @google/genai client
│   ├── controllers/            # HTTP request/response shaping only
│   │   ├── auth.controller.ts
│   │   ├── product.controller.ts
│   │   ├── category.controller.ts
│   │   └── aiProduct.controller.ts
│   ├── services/                # business logic — DB, Redis, Gemini
│   │   ├── auth.service.ts
│   │   ├── token.service.ts      # dual-token issue/rotate/revoke
│   │   ├── cache.service.ts      # generic Redis cache-aside helpers
│   │   ├── category.service.ts
│   │   ├── product.service.ts
│   │   ├── aiProduct.service.ts  # the AI listing generator (star feature)
│   │   └── upload.service.ts     # persists Multer buffers, returns a URL
│   ├── routes/
│   │   ├── index.ts
│   │   ├── auth.routes.ts
│   │   ├── product.routes.ts
│   │   ├── category.routes.ts
│   │   └── admin.routes.ts       # POST /api/admin/products/ai-create lives here
│   ├── middlewares/
│   │   ├── authenticate.ts       # JWT access-token check
│   │   ├── authorize.ts          # RBAC
│   │   ├── upload.ts             # Multer config
│   │   ├── validate.ts           # Zod request validation
│   │   ├── rateLimiter.ts        # Redis-backed, hand-rolled
│   │   ├── notFound.ts
│   │   └── errorHandler.ts
│   ├── schemas/                  # Zod schemas + inferred types
│   │   ├── auth.schema.ts
│   │   ├── product.schema.ts
│   │   └── aiProduct.schema.ts   # also defines Gemini's responseSchema shape
│   ├── types/
│   │   ├── express.d.ts          # augments Express.Request (user, validated)
│   │   └── jwt.types.ts
│   ├── utils/
│   │   ├── AppError.ts
│   │   ├── asyncHandler.ts
│   │   ├── apiResponse.ts
│   │   ├── serializers.ts        # Prisma Decimal → number, safely
│   │   ├── jwt.ts
│   │   ├── password.ts
│   │   └── logger.ts
│   ├── generated/prisma/         # created by `npm run prisma:generate` — gitignored
│   ├── app.ts                     # Express app factory (middleware pipeline)
│   └── server.ts                  # boot + graceful shutdown
├── uploads/                       # local KYC docs + AI product photos (gitignored)
├── docs/GUIDE.md                  # the deep-dive teaching document
├── prisma.config.ts                # Prisma 7 CLI config (schema path, migrations, seed)
├── .env.example
├── package.json
└── tsconfig.json
```

---

## Prerequisites

- Node.js **20+**
- A running PostgreSQL instance
- A running Redis instance
- A Gemini API key — create one free at <https://aistudio.google.com/app/apikey>

---

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Copy the env template and fill in real values
cp .env.example .env
# At minimum, set DATABASE_URL, REDIS_URL, GEMINI_API_KEY,
# and generate two secrets with: openssl rand -hex 32

# 3. Generate the Prisma client
npm run prisma:generate

# 4. Create the database schema (interactive, generates a migration)
npm run prisma:migrate
# — you'll be prompted to name the migration, e.g. "init"

# 5. Seed the five product categories + a super admin + a demo (approved) vendor
npm run prisma:seed

# 6. Start the dev server (auto-restarts on file changes)
npm run dev
```

The API is now running at `http://localhost:4000`. Health check:
`GET http://localhost:4000/health`.

**Seeded logins** (from step 5, useful for testing immediately):

| Role        | Identifier                | Password        |
| ------------ | --------------------------- | ----------------- |
| SUPER_ADMIN   | `superadmin@bravomart.ng`     | `ChangeMe123!`     |
| VENDOR (approved) | `demo-vendor` (or `demo.vendor@bravomart.ng`) | `VendorPass123!` |

Change both passwords before this ever touches a real environment — they're
seed data, not secrets.

### Production build

```bash
npm run build      # compiles src/ → dist/ via tsc
npm start          # runs dist/server.js
npm run prisma:migrate:deploy   # applies existing migrations, non-interactive — use this in CI/CD, not `prisma:migrate`
```

---

## API reference

All successful responses share one envelope: `{ "success": true, "data": ... }`
(list endpoints also include a `meta` object with pagination info). All
errors share another: `{ "success": false, "message": "...", "details"?: ... }`.

| Method | Path                              | Auth                          | Purpose |
| ------- | ----------------------------------- | -------------------------------- | --------- |
| POST    | `/api/auth/register`                  | Public                            | Register a customer |
| POST    | `/api/auth/vendor/register`           | Public (`multipart/form-data`, field `idCard`) | Register a vendor — status starts `PENDING` |
| POST    | `/api/auth/login`                     | Public, rate-limited              | `{ identifier, password }` → access token + refresh cookie |
| POST    | `/api/auth/refresh`                   | Refresh cookie                    | Rotates the refresh token, issues a new access token |
| POST    | `/api/auth/logout`                    | Refresh cookie (optional)         | Revokes the current session |
| GET     | `/api/auth/me`                        | Access token                      | Current user profile |
| GET     | `/api/categories`                     | Public                            | The 5 seeded categories |
| GET     | `/api/products`                       | Public                            | `?category=&page=&limit=` — cached |
| GET     | `/api/products/:id`                    | Public                            | Single product — cached |
| **POST**    | **`/api/admin/products/ai-create`**       | **Access token, role `VENDOR`/`ADMIN`/`SUPER_ADMIN`, rate-limited** | **The AI listing generator (see below)** |

### The AI product creation endpoint

`multipart/form-data` with:

- `prompt` (string, required, 10–2000 chars) — a natural-language product description
- `image` (file, optional) — JPEG/PNG/WEBP, analyzed by Gemini alongside the prompt
- `vendorId` (string UUID, **required for `ADMIN`/`SUPER_ADMIN` callers, ignored for `VENDOR` callers**, who always publish to their own shop)

```bash
curl -X POST http://localhost:4000/api/admin/products/ai-create \
  -H "Authorization: Bearer <vendor_access_token>" \
  -F "prompt=Vintage genuine cowhide leather jacket, size L, brown, selling for 45000 naira" \
  -F "image=@/path/to/jacket.jpg"
```

Response — `201 Created`:

```json
{
  "success": true,
  "data": {
    "id": "…",
    "title": "Vintage Brown Cowhide Leather Jacket – Size L",
    "description": "…",
    "price": 45000,
    "inventory": 1,
    "tags": ["leather jacket", "vintage", "cowhide", "brown", "size l"],
    "imageUrl": "/uploads/products/<uuid>.jpg",
    "isAiGenerated": true,
    "category": { "id": "…", "name": "Clothing", "slug": "clothing" },
    "vendor": { "id": "…", "shopName": "Bravo Mega Store", "shopAddress": "…" },
    "createdAt": "…",
    "updatedAt": "…"
  }
}
```

Full request/response walkthrough, including how Gemini's structured output
is enforced and re-validated, is in `docs/GUIDE.md`.

---

## Notable 2026 stack decisions worth knowing about

These are things that changed recently enough that older tutorials will
mislead you. Full explanations are in `docs/GUIDE.md`; the short version:

- **Prisma 7 dropped its Rust query-engine binary by default.** `PrismaClient`
  now requires a driver adapter (`@prisma/adapter-pg` here) instead of
  connecting on its own, and the generated client lives in your own `src/`
  tree (`src/generated/prisma/`), not in `node_modules/@prisma/client`. CLI
  configuration (schema path, migrations folder, the seed command) now lives
  in `prisma.config.ts`, not `package.json`.
- **Express 5 made `req.query` a read-only getter.** You cannot do
  `req.query = parsedData` anymore — see how `middlewares/validate.ts` works
  around this with a separate `req.validated` namespace.
- **Zod 4 promotes common formats to the top level** — `z.email()`, `z.uuid()`
  instead of `z.string().email()` / `z.string().uuid()`.

---

## Scope note

This deliverable implements exactly what was asked for: the auth
architecture, RBAC, the product catalog, and the AI-creation endpoint. It
deliberately does **not** implement orders, escrow/payments, or dispatch
logistics — those exist in the frontend's UI (`CheckoutPage`,
`DispatcherPortal`, `BravoSuperAdmin`'s escrow settings) but are a
substantial separate build. The layering here (controllers → services →
Prisma, with Redis cache invalidation on writes) is set up to extend to
those cleanly whenever that's the next milestone.
#   b r a v o m a r t - b a c k e n d  
 