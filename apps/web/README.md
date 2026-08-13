# Menutha Web — order at the table from any browser

The customer web app. A diner points their phone camera at the printed table
QR (`https://<host>/scan/<qr_token>`), the menu opens in the browser — no app
install, no sign-up — they order, and the kitchen's live board (Menuva) gets
the order instantly over Supabase Realtime. Works on phones, tablets, and
desktops.

## Run

```bash
cd apps/web
npm install
npm run dev          # http://localhost:5180
```

Try it instantly with no backend: open http://localhost:5180 and tap
**“Try the demo menu”** (or go to `/scan/demo`) — full flow with a simulated
kitchen (Placed → Accepted → Preparing → Ready → Served).

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `VITE_SUPABASE_URL` | the live project URL | Supabase project |
| `VITE_SUPABASE_ANON_KEY` | the publishable key | anon key |

## Backend prerequisite

Apply `apps/api/db/DEPLOY_ALL.sql` (includes
`2026-07-15_web_guest_access.sql`) to the Supabase project. It adds:

- `get_order_status(uuid)` — guest-safe order tracking by unguessable order id
  (guests have no auth session, so RLS hides their rows from direct selects).
- `menu_item` / `menu_category` in the realtime publication — open menus
  (web + mobile) refresh live when the restaurant edits dishes.

## How the QR links both apps

Printed QRs (generated in Menuva → Tables & QR) encode
`https://<WEB_ORDER_URL>/scan/<qr_token>`:

- **No app installed** → the phone camera opens this web app.
- **Menutha app installed** → the app's scanner matches the same
  `/scan/<token>` path and opens the native flow.

The base URL comes from `EXPO_PUBLIC_WEB_ORDER_URL` in the mobile build
(default `https://order.menutha.app`).

## Deploy

`npm run build` → static files in `dist/`. Host anywhere (Vercel / Netlify /
Cloudflare Pages). **Required:** an SPA rewrite so `/scan/*`, `/track/*` etc.
serve `index.html` (e.g. Netlify `_redirects`: `/*  /index.html  200`).
