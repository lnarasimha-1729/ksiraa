# KSiraa Orders App

This is the KSiraa ordering app production-MVP. It includes customer login, ordering, admin product controls, order management, customer records, announcements, privacy/terms pages, daily database backups, and provider hooks for SMS OTP, WhatsApp Business, and online payments.

## Start Locally

```powershell
node server.mjs
```

Open:

```text
http://127.0.0.1:4173
```

## Local Login Details

Customer OTP for local testing:

```text
123456
```

Default admin:

```text
Mobile: 9999999999
Password: ksiraa2468
```

Change the admin password before public use.

## Production Environment

Create a `.env` file from `.env.example`, or set these before hosting:

```powershell
$env:NODE_ENV="production"
$env:HOST="127.0.0.1"
$env:PORT="4173"
$env:PUBLIC_BASE_URL="https://orders.ksiraa.com"
$env:ADMIN_PHONE="your-admin-mobile"
$env:ADMIN_PASSWORD="a-strong-password"
$env:OWNER_WHATSAPP="91yourbusinessnumber"
$env:BACKUP_RETENTION_DAYS="30"
node server.mjs
```

The server reads `.env` automatically when the file exists in this folder.

## Real SMS OTP

Set:

```powershell
$env:SMS_PROVIDER_URL="https://your-sms-provider/send"
$env:SMS_PROVIDER_TOKEN="provider-token"
```

The app sends:

```json
{ "to": "9876543210", "message": "Your KSiraa login OTP is 123456." }
```

Use your SMS provider dashboard to map this payload if their API expects different field names.

## Real WhatsApp Business

Set:

```powershell
$env:WHATSAPP_API_URL="https://your-whatsapp-provider/send"
$env:WHATSAPP_API_TOKEN="provider-token"
```

The app sends:

```json
{ "to": "919876543210", "message": "KSiraa update..." }
```

For WhatsApp Business API, promotional broadcasts may require approved templates depending on your provider and WhatsApp rules.

## HTTPS Hosting With Domain

Use a domain like:

```text
orders.ksiraa.com
```

Recommended deployment shape:

- Run this Node app privately on `127.0.0.1:4173`
- Put Nginx, Caddy, Cloudflare Tunnel, Render, Railway, or another HTTPS reverse proxy in front
- Set `PUBLIC_BASE_URL=https://orders.ksiraa.com`
- Do not expose plain HTTP publicly

## Daily Database Backup

The app stores data here:

```text
data/ksiraa-db.json
```

Automatic backups are written here:

```text
backups/
```

Backups run:

- Once when the server starts
- Every 24 hours while the server is running
- Old backups are removed after `BACKUP_RETENTION_DAYS`

Copy the `backups/` folder to cloud storage regularly for off-machine safety.

## Privacy Policy And Terms

Included pages:

```text
privacy.html
terms.html
```

They are linked from the app footer. Review them with a local legal/accounting advisor before a public launch.

## Optional Online Payments

Customers can choose:

- Cash on delivery
- UPI on delivery
- Online payment

Online payment requires:

```powershell
$env:PAYMENT_PROVIDER_URL="https://your-payment-provider/create-link"
$env:PAYMENT_PROVIDER_TOKEN="provider-token"
$env:PAYMENT_RETURN_URL="https://orders.ksiraa.com/"
```

The app sends order/payment JSON and expects the provider response to include one of:

```json
{ "paymentUrl": "https://payment-link" }
```

or `url` / `short_url`.

## Important

Real launch still requires your provider accounts, tokens, domain DNS, and HTTPS hosting access. Those cannot be completed from code alone.
