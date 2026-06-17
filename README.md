# KSiraa Orders

A self-hosted ordering platform for a fresh-dairy brand. Customers place orders from a single-page web app; the owner manages products, orders, customers, and broadcast updates from a built-in admin panel. A WhatsApp bot (via Meta Cloud API) lets customers order without leaving WhatsApp.

Single Node process, MySQL backend, no build step, no framework.

---

## What's inside

- **Customer ordering site** — product catalogue, cart, address + payment-method form, order placement, "My orders" view, order success modal.
- **Admin panel** (`/` → Admin tab) — three sub-tabs:
  - **Orders** — list, status workflow (Received → Preparing → Out for delivery → Delivered → Paused → Cancelled), delete.
  - **Products** — add, edit price/weight, mark sold out / available, delete.
  - **Customers** — search, edit, delete, multi-select + broadcast WhatsApp updates. Compose-and-publish notices that show on the customer site and (optionally) send through WhatsApp.
- **WhatsApp Cloud API bot** — customer sends `hi` → bot replies with a list of products → user picks items, gives name + address → order is created in the same `orders` table. No website visit required.
- **Order ID format** — `KS-YYYY-D<n>` (year + sequence), human-readable.
- **Daily-frequency / one-time / weekly / twice-weekly / monthly** subscription frequencies on each order.
- **Notice band** — owner publishes short updates that appear at the top of the customer site.
- **Privacy & Terms pages** included.

---

## Tech

- Node 20+ (uses `node:http`, `node:fs`, native `fetch`)
- MySQL 8 (via `mysql2`)
- Plain HTML / CSS / vanilla JS on the frontend (no React, no build step)
- WhatsApp Cloud API (Meta, free tier 1,000 conversations/month)

No build pipeline. Files in this folder are what the server ships.

---

## Run locally

```powershell
# 1. Install dependencies
npm install

# 2. Copy and fill .env
cp .env.example .env
# edit .env with your DB credentials and admin login

# 3. Start the server
node server.mjs
```

The server starts on `http://127.0.0.1:4173` by default. Tables are created automatically on first boot.

### Default local credentials

| Role | Phone | Password |
|---|---|---|
| Admin | `9999999999` | `ksiraa2468` |
| OTP for any customer login (dev only) | — | `123456` |

Both can be overridden via `.env`. **Change the admin password before deploying publicly.**

---

## Configuration

All config lives in `.env`. See `.env.example` for the full list. The critical ones:

```env
# Server
PORT=4173
HOST=127.0.0.1
PUBLIC_BASE_URL=https://orders.example.com

# Admin
ADMIN_PHONE=9591747474
ADMIN_PASSWORD=a-strong-password
OWNER_WHATSAPP=919591747474

# MySQL
DB_HOST=your-mysql-host
DB_USER=your-db-user
DB_PASSWORD=your-db-password
DB_NAME=your-db-name
DB_PORT=3306

# WhatsApp Cloud API (Meta)
WHATSAPP_PHONE_NUMBER_ID=your-phone-number-id
WHATSAPP_ACCESS_TOKEN=your-permanent-access-token
WHATSAPP_VERIFY_TOKEN=ksiraa_verify_token
```

The server reads `.env` automatically. If a value is missing the app falls back to safe defaults where possible; WhatsApp features are silently skipped (logged as `[WhatsApp demo]`) until credentials are present.

---

## WhatsApp integration

KSiraa ships with two layers of WhatsApp support:

### 1. Outbound (admin → customer)

The admin **Customers** tab has multi-select checkboxes and a search box. Type a broadcast title + message, pick the customers, hit **Send WhatsApp**. The server POSTs to the Meta Cloud API per customer.

**Important Meta rules** (no code can bypass these):

- Free-form text only works within 24 hours of the customer last messaging you.
- Outside that window, Meta requires a pre-approved message template.
- Approve one generic template in Meta Business Manager once, then `WHATSAPP_TEMPLATE_NAME` in `.env` enables broadcasts to all customers.

### 2. Inbound (customer → bot)

A webhook receives incoming WhatsApp messages at:

```
GET  /api/webhooks/whatsapp   (verification)
POST /api/webhooks/whatsapp   (incoming messages)
```

Configure these in Meta → WhatsApp → Configuration. Use `WHATSAPP_VERIFY_TOKEN` as the verify token.

The bot supports a full ordering flow inside WhatsApp:

```
USER:  hi
BOT:   Welcome! [Order Now] [My Orders]
USER:  taps Order Now
BOT:   shows interactive product list (live from DB)
USER:  picks items, types address
BOT:   confirms order, writes to the same `orders` table
```

Orders placed via the bot show up in the admin Orders tab indistinguishable from website orders.

### Local webhook testing

Webhooks need a public HTTPS URL. For local development:

```powershell
ngrok http 4173
```

Use the `https://...ngrok-free.app` URL as the **Callback URL** in Meta. Subscribe to the `messages` field.

---

## Production deploy

Most cleanly deployed behind a TLS-terminating reverse proxy (Nginx, Caddy, Cloudflare Tunnel, Hostinger Node app panel, etc.).

1. Upload `server.mjs`, `db.mjs`, `app.js`, `index.html`, `styles.css`, `assets/`, `privacy.html`, `terms.html`, `package.json`.
2. Set environment variables in the host's panel (do **not** upload `.env`).
3. Run `npm install` once.
4. Start with `node server.mjs`.
5. Point your domain at the server, enable HTTPS.
6. In Meta, set the webhook to `https://yourdomain.com/api/webhooks/whatsapp`.

### What NOT to upload

- `.env` (secrets go in the host's env-var panel)
- `node_modules/` (host runs `npm install`)
- `.git/`
- `server.err.log` / `server.out.log`

---

## Project structure

```
.
├── server.mjs             # HTTP server, all API routes, WhatsApp bot logic
├── db.mjs                 # MySQL connection + schema initialisation
├── app.js                 # Frontend SPA logic (vanilla JS)
├── index.html             # Single-page shell
├── styles.css             # Dark theme + admin layout
├── assets/                # Logo + product imagery
├── privacy.html           # Privacy policy
├── terms.html             # Terms of service
├── .env.example           # Documented env-var template
└── package.json
```

---

## Data model (auto-created)

| Table | Purpose |
|---|---|
| `products` | catalogue rows (id, name, size, price, description, sold_out, sort_order) |
| `customers` | customer profiles keyed by phone |
| `orders` | every order with items stored as JSON (id like `KS-2026-D7`) |
| `notices` | broadcast updates |
| `sessions` | admin / customer session tokens |
| `otps` | OTP hashes for customer login |
| `admin` | single-row admin credentials |
| `whatsapp_sessions` | per-phone bot conversation state |
| `meta` | misc settings (`ownerWhatsApp` etc.) |

All tables use InnoDB + utf8mb4. The schema is idempotent — booting the server against an existing DB is safe.

---

## Security notes

- Admin passwords are scrypt-hashed.
- Session tokens are 32-byte random hex.
- OTP codes are scrypt-hashed before being stored.
- Customer auth uses phone + OTP; admin auth uses phone + password.
- **No JS framework, no dependency tree to audit beyond `mysql2`.** Surface area is small by design.

Before going public:

- [ ] Change `ADMIN_PASSWORD`
- [ ] Rotate the WhatsApp access token (especially if it's been shared)
- [ ] Enable HTTPS on your domain
- [ ] Review `privacy.html` + `terms.html` with a local advisor

---

## License

MIT — use it, fork it, modify it. Attribution appreciated but not required.

---

## Acknowledgements

Built for KSiraa, a small dairy in Bengaluru.
