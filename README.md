# Charter

Private, single-tenant contract management and electronic signature. One owner
(you), external signers who never hold an account, and a document history where
the original upload is never mutated.

Built with Next.js (App Router), TypeScript, Tailwind v4, Supabase (Postgres /
Auth / Storage), `pdf-lib`, and Resend. Deploys to Vercel.

---

## Status

| Phase | Scope | State |
| --- | --- | --- |
| 1 | Auth, allowlist, route protection, app shell | **Done** |
| 2 | PDF upload + private storage | Not started |
| 3 | Overlay PDF editor | Not started |
| 4 | Signatures | Not started |
| 5 | Send for signature, signer flow, audit trail | Not started |
| 6 | Dashboard, folders, tags, search, reminders | Not started |

---

## Setup

### 1. Supabase

Create a project (pick a region near you — `eu-west-3` Paris or
`eu-central-1` Frankfurt). Keep the database password somewhere safe; you will
need it for the SQL editor.

Then run the migration. Open **SQL Editor → New query**, paste the whole of
[`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql),
and run it.

**Before you run it, edit the seed insert near the top** so it lists your own
address:

```sql
insert into public.owner_allowlist (email, note)
values ('joao@cobalto.cc', 'owner')
on conflict (email) do nothing;
```

Migrations are applied by pasting SQL, not through the Supabase CLI. Every
future schema change is written to `supabase/migrations/` **and** printed in
full so it can be pasted the same way.

### 2. Create your user

**Authentication → Users → Add user**, with your allowlisted address and a
password. Tick *Auto Confirm User*. Order does not matter — nothing in this
schema touches `auth.users`.

Then turn signups off: **Authentication → Sign In / Providers → Allow new users
to sign up → off**. That, plus `shouldCreateUser: false` on the magic-link
call, is what stops anyone else obtaining an account. An earlier draft used a
trigger on `auth.users` for this; don't. An exception raised there surfaces only
as "Database error creating new user" and blocks all account creation.

The profile row is created by the app on first sign-in, so a user created before
the migration ran is fine.

### 3. Resend (needed from Phase 5; worth doing now for auth email)

1. Add and verify your sending domain, publishing the SPF and DKIM DNS records
   Resend gives you.
2. **API Keys → Create**, with *Sending access* only. That value is
   `RESEND_API_KEY`.
3. Point Supabase Auth at it so magic links are not throttled by Supabase's
   shared sender: **Supabase → Authentication → SMTP Settings**

   | Field | Value |
   | --- | --- |
   | Host | `smtp.resend.com` |
   | Port | `465` |
   | Username | `resend` |
   | Password | your `RESEND_API_KEY` |
   | Sender email | the address in `EMAIL_FROM` |

   Supabase's built-in sender caps at a handful of emails per hour, which will
   silently break magic links once you start testing in earnest.

### 4. Environment

Copy `.env.example` to `.env.local` and fill it in. Every variable is
documented in that file. Two of them you generate yourself:

```sh
openssl rand -base64 32   # SIGNER_TOKEN_PEPPER
openssl rand -base64 32   # CRON_SECRET
```

`SUPABASE_SERVICE_ROLE_KEY` bypasses RLS entirely. It is server-only and must
never be renamed into a `NEXT_PUBLIC_*` variable.

Keep `OWNER_ALLOWLIST` and the `owner_allowlist` table in agreement. The table
is the authority — it backs `is_owner()`, which every RLS policy is built on —
and the environment variable is the app-layer mirror that lets the login route
reject an address before Supabase is involved.

### 5. Vercel

Import the repository, then paste the same variables into **Project Settings →
Environment Variables**. Set `NEXT_PUBLIC_APP_URL` to the deployment's own
origin (`https://charter-yourteam.vercel.app` or your custom domain) — magic
links are built from it, so a stale value sends people to the wrong place.

Also add your deployment origin to **Supabase → Authentication → URL
Configuration → Redirect URLs**, including `.../auth/callback`.

---

## Working on it locally

This machine has no Node runtime, so the loop is: edit, commit, push, and let
GitHub Actions and the Vercel preview do the verifying.

- `.github/workflows/ci.yml` runs typecheck, lint, and build on every push.
  The build uses placeholder credentials — nothing may read a real secret at
  build time, only at request time.
- `.github/workflows/lockfile.yml` is manual (**Actions → Refresh lockfile →
  Run workflow**). Run it after any dependency change to generate and commit
  `package-lock.json`. Until it has run once, builds resolve dependencies
  fresh and are not reproducible.

With Node available, the usual `npm install` / `npm run dev` works too.

---

## Security model

Authorization is layered, and no single layer is load-bearing on its own.

**RLS, deny by default.** Every table has RLS enabled and forced, with no
permissive policy for `anon`. Owner access is gated on `public.is_owner()`,
which checks the JWT's email against `owner_allowlist`. Removing an address
from that table revokes access immediately, live session or not.

**A trigger on `auth.users`.** A non-allowlisted address cannot become an
account at all, so a leaked or forwarded magic link is inert.

**`requireOwner()`, not middleware.** `src/lib/auth.ts` is the real
boundary, called by every protected page and every mutation. Middleware only
refreshes the session cookie and bounces obvious anonymous traffic —
deliberately, because Next.js middleware has had header-spoofing bypasses
(CVE-2025-29927) and cannot see which row a request concerns.

**Login rate limiting.** Two fixed windows in Postgres, per IP (20 / 10 min)
and per address (8 / 10 min). No Redis dependency. It fails closed: if the
accounting call errors, the attempt is refused.

**Uniform failure messages.** Wrong password, unknown address, and
not-allowlisted all produce the same text, and the magic-link route reports
"a link is on its way" whether or not it sent one. Nothing about the login
screen reveals which addresses exist.

**`noindex` everywhere**, as an `X-Robots-Tag` header on every route in
`next.config.ts` plus route-level metadata, alongside `nosniff`, `DENY`
framing, HSTS, and a restrictive `Permissions-Policy`.

Public routes are exactly `/login`, `/auth/*`, `/sign/*`, and `/legal`.
Everything else requires a session.

---

## Layout

```
src/
  app/
    (app)/            Owner-only. The group layout calls requireOwner().
    login/            Password + magic-link sign-in, server actions
    auth/callback/    Magic-link code exchange, re-checks the allowlist
    sign/[token]/     The only genuinely public route (Phase 5)
    legal/            Electronic signature notice
  components/
    ui/               Primitives — button, input, label, card, alert
    shell/            Sidebar, sign-out, page header, empty state
  lib/
    auth.ts           requireOwner() — the authorization boundary
    allowlist.ts      App-layer mirror of owner_allowlist
    rate-limit.ts     Postgres-backed fixed-window limiter
    env.ts            Public config    env.server.ts  Secrets
    supabase/         Browser, server, admin, and middleware clients
  middleware.ts       Session refresh + anonymous redirect only
supabase/migrations/  Paste-ready SQL, applied by hand
```

---

## Electronic signature notice

Signatures created in Charter are **simple electronic signatures**. Their
validity rests on the signer's demonstrated intent to sign — captured through
an explicit consent step before any field can be completed — together with an
audit trail recording every view, signature, and decline with a timestamp, IP
address, user agent, and a SHA-256 hash of the document at each stage. A
certificate of completion summarising this is appended to the final PDF.

This is consistent with the US ESIGN Act and with simple electronic signatures
under EU eIDAS (Regulation 910/2014). It is **not** an advanced or qualified
electronic signature. Charter is not a notarisation service, a certificate
authority, or a qualified trust service provider. Documents requiring
notarisation, a qualified certificate, or a witnessed signature under their
governing law need a different tool.

Not legal advice.
