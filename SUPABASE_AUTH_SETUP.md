# Supabase auth: the part only the project owner can do

Password reset is complete in code on both surfaces. It still cannot deliver a
single email until two settings are right in the Supabase dashboard, and
**neither can be done from this repository or by any tool an agent has** — auth
configuration is not in the Management API surface that the Supabase MCP
exposes (that covers SQL, migrations, edge functions, logs, advisors and
types). It is dashboard-only, and it needs whoever owns the project.

This file exists because the failure gives no hint that a setting is the cause.
The app reports a 500, and the person reading it concludes their own email
address is wrong.

---

## 0. Which project

Production is **`xnhcziciilylzcaupqoq`**. Three places in this repo agree:

| | |
|---|---|
| `sql/README.md` | "the production database (`xnhcziciilylzcaupqoq`)" |
| `apps/web/src/lib/supabase.ts` | the `VITE_SUPABASE_URL` default |
| `.github/workflows/deploy.yml` | `SB=https://xnhcziciilylzcaupqoq.supabase.co` |

It is **not** `rdfwgasiwmmdrvrpwtgn`. That project still exists under the
`slveggies` organisation, is **paused**, and nothing in this repo points at it
any more. Do not apply any of the settings below to it by mistake — the two are
easy to confuse because both are called "Menutha".

Everything below has to be done on `xnhcziciilylzcaupqoq`.

## 1. The reported failure, decoded

A partner tapped **Forgot password** on 2026-09-12 and got a dialog containing
a raw HTTP response. Reading it:

| Field | Value | What it says |
|---|---|---|
| `sb-project-ref` | `xnhcziciilylzcaupqoq` | the request reached this project |
| `sb-gateway-version` | `2` | the gateway answered; Cloudflare only relayed |
| `status` | `500` | the server failed, not the client |
| `content-length` | `70` | exactly the length of the body below |

70 bytes of `application/json` from GoTrue on the recovery endpoint is

```json
{"code":"unexpected_failure","message":"Error sending recovery email"}
```

which is 70 characters. **The app was fine. The mail did not go out.**

## 2. Custom SMTP — required

Supabase's built-in sender **only delivers to addresses belonging to the
project's own team**, and is capped at a couple of messages an hour. It is a
development convenience. For restaurant owners it fails every time, with the
500 above.

**Authentication → Emails → SMTP Settings → Enable Custom SMTP.**

Any transactional provider works — Resend, SendGrid, Postmark, Amazon SES, or
the mailbox behind the live domain. Fill in host, port, username, password, and
a sender address **on a domain you control**. Not a gmail.com address: most
receivers reject or spam-folder it on SPF/DKIM grounds, which looks identical
to "the reset is broken" from the owner's side.

Then **Authentication → Rate Limits** and raise the per-hour email cap. The
default is low enough to matter the moment reset mails are genuinely being
sent, and hitting it produces the same 500.

## 3. Redirect URLs — required

`resetByIdentifier` passes `redirectTo: RESET_REDIRECT()`, which resolves to
`${window.location.origin}/partner`. GoTrue **silently ignores a `redirectTo`
that is not on the allow-list** and sends the person to the Site URL instead —
the marketing landing page, which ignores the token. There is no error when
this happens: the mail arrives and the link goes nowhere.

**Authentication → URL Configuration → Redirect URLs**, add the portal's own
origin plus `/partner` for every host the portal is served from — the live
domain, and the GitHub Pages host if that is still in use.

The mobile app resets through the same project. Add its scheme too, in the
shape that app's `Linking.createURL` prints.

## 4. Which of the three it was

**Logs → Auth**, filtered to the incident timestamp. The entry distinguishes
them outright:

- a connection or authentication failure to the SMTP host → §2, credentials
- no SMTP host configured at all → §2, not enabled
- a 429 or a rate-limit note → §2, the per-hour cap

## 5. Check it worked

1. Portal → **Forgot password?** with a real account email.
2. The screen should say a link is on its way. If it still names a problem, the
   wording now distinguishes the causes: "a problem on our side" means SMTP is
   still wrong; "too many attempts" means the rate limit.
3. The mail arrives. The link opens the portal's `/partner` **recovery form**,
   not the landing page. If it opens the landing page, §3 is missing.
4. Set a password, then sign in with it.
5. Repeat from the mobile app, which shares this project.

## 6. Separately: three migrations are still waiting

`sql/README.md` lists three money-path migrations published for the operator to
run by hand. They are unrelated to password reset, but they are the other thing
on this project that needs someone in the dashboard, so they are worth doing in
the same sitting. Order and verify blocks are in that file.

---

## For an agent reading this

You cannot do any of §2–§4. Two independent reasons, both worth stating to the
user rather than discovering twice:

1. **Account.** `xnhcziciilylzcaupqoq` belongs to a Supabase account that a
   session's connector may not hold. `list_projects` is the check: if it
   returns only `qosqizsrkkahltvauopg` (Intelligent Logistics) and
   `rdfwgasiwmmdrvrpwtgn` (Menutha, paused), the live project is not reachable
   and every call against it answers "You do not have permission".
2. **Surface.** Even with the right account connected, SMTP settings, redirect
   URLs and auth rate limits are not exposed by the Supabase MCP at all. There
   is no tool for them. Reading logs and advisors, running SQL, and deploying
   edge functions are; auth configuration is not.
