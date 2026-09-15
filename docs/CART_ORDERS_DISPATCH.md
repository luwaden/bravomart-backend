# Cart, Orders & Dispatch

This adds the domain the frontend's checkout/dispatch UI was previously
running entirely on mock data for. It follows the same
Routes → Controllers → Services → Prisma layering as the rest of the
backend — see `docs/GUIDE.md` for that pattern explained from scratch.

## Domain shape

```
Cart (1 per user) ── CartItem (product + quantity, price NOT snapshotted)

Order (1 per checkout)
  └─ Shipment (1 per vendor in that checkout)
       ├─ OrderItem[]        — fully snapshotted title/price/weight/image
       ├─ DispatchRiderProfile (nullable — assigned after checkout)
       └─ escrowStatus: HELD | RELEASED | REFUNDED   (per-vendor, not per-order)

WalletTransaction — append-only ledger; the only thing allowed to move a
                    vendor's VendorProfile.walletBalance
```

A cart spanning three vendors becomes **one** Order with **three**
Shipments — one buyer-facing order history entry, three independently
tracked fulfillments, three independent escrow holds. See the doc comments
on `Order`/`Shipment` in `prisma/schema.prisma` for the full reasoning.

## New endpoints

| Method | Path | Who |
|---|---|---|
| GET/POST/PATCH/DELETE | `/api/cart`, `/api/cart/items/:productId` | any logged-in user |
| POST | `/api/orders` (checkout) | any logged-in user |
| GET | `/api/orders`, `/api/orders/:orderId` | order owner |
| POST | `/api/orders/:orderId/shipments/:shipmentId/confirm-delivery` | order owner — releases escrow |
| POST | `/api/orders/:orderId/shipments/:shipmentId/dispute` | order owner |
| PATCH | `/api/vendor/me/location` | VENDOR — persists "capture shop GPS" |
| GET | `/api/vendor/me/wallet` | VENDOR — wallet transaction history |
| POST | `/api/auth/dispatcher/register` | public — mirrors vendor registration |
| PATCH | `/api/dispatch/me/availability`, `/me/location` | DISPATCHER |
| GET | `/api/dispatch/available-shipments` | DISPATCHER |
| POST | `/api/dispatch/shipments/:id/accept`, `/picked-up`, `/delivered` | DISPATCHER (must own the shipment) |
| GET | `/api/admin/orders/:orderId` | ADMIN/SUPER_ADMIN |
| POST | `/api/admin/orders/:orderId/shipments/:shipmentId/force-release` | ADMIN/SUPER_ADMIN — backs BravoAdmin.jsx |

## Deliberately deferred (not built here)

- **No payment gateway.** `checkout()` marks `paymentStatus: 'ESCROW_HELD'`
  immediately — there's nothing to wait on a webhook from yet. Wiring
  Paystack/Flutterwave means: create the Order with `paymentStatus:
  'PENDING'` instead, return a payment link/reference, and flip it to
  `ESCROW_HELD` from a webhook handler that verifies the gateway's signature.
  The rest of the transaction shape in `order.service.ts` doesn't change.
- **No scheduled auto-release job.** `Shipment.escrowReleaseAt` is set (by
  the rider's "delivered" action) but nothing currently reads it. A cron
  job / queue worker that finds `escrowStatus: HELD AND escrowReleaseAt <
  now()` and calls the same `recordWalletTransaction` path
  `confirmShipmentDelivery` uses would close this loop.
- **No rider payout for `shippingFee`.** Right now a shipment's `shippingFee`
  is charged to the buyer but never credited to anyone — only `itemsTotal`
  is released to the vendor. A real build-out would credit the assigned
  rider's `DispatchRiderProfile.walletBalance` (via the same wallet ledger
  pattern) when they mark a shipment delivered.
- **Refunds** (`WalletTransactionType.ESCROW_REFUND` / `EscrowStatus.REFUNDED`)
  are modeled in the schema but no endpoint triggers them yet — that's an
  admin-dispute-resolution action layered on top of the existing dispute
  flow, deliberately left for whoever builds the admin dispute UI to decide
  the exact refund rules (full vs. partial, who eats the shipping fee, etc).

## Frontend follow-ups this surfaced

- `CheckoutPage.jsx`'s buyer sign-in is still a mock (accepts any
  credentials) even though `POST /api/auth/register` and
  `POST /api/auth/login` already work for real, generic `CUSTOMER` accounts.
  Swapping the mock `handleLoginSubmit`/`handleRegisterSubmit` for real
  calls to `services/api.js` is a frontend-only change at this point.
- `DispatchConfigurator.jsx` currently shows the **buyer** a list of riders
  to WhatsApp/call directly. The backend now models the more standard
  flow instead — riders browse `GET /api/dispatch/available-shipments` and
  accept one — so a real build-out would move rider-matching UI to a
  rider-facing screen (`DispatcherPortal.jsx`) rather than the buyer's
  checkout page.
- None of `services/api.js` has cart/order/dispatch client functions yet —
  this pass only built the backend. Wiring `CheckoutPage`/`AccountPage`/
  `DispatcherPortal` to call these real endpoints instead of their current
  local mock state is the natural next step.
