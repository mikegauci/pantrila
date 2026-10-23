# pantrila.com: landing page, app.pantrila.com and api.pantrila.com

Goal: `pantrila.com` is a landing page (features, where to get the app), `app.pantrila.com` is the
web app that runs today at `pantrila.vercel.app`, and `api.pantrila.com` is the API that runs today
at `pantrio-api.onrender.com`. Magic-link email works for everyone, and the landing site carries the
privacy and terms pages.

Decisions (owner, 2026-10-22):

- Landing page: a new `site/` folder in this repo, its own Next.js app and its own Vercel project.
- DNS: move the nameservers from GoDaddy to Vercel. GoDaddy stays the registrar (renewals, billing).
- Native apps: not built yet. The landing page leads with "Open in browser"; App Store and Google
  Play badges say "Coming soon".
- In scope: `api.pantrila.com`, magic-link email through a mail service, privacy and terms pages,
  and a permanent redirect from `pantrila.vercel.app` to `app.pantrila.com`.

## Target layout

| Address | Serves | Hosted on |
| --- | --- | --- |
| `pantrila.com` | landing page, `/privacy`, `/terms` | Vercel project `pantrila-site` (root `site/`) |
| `www.pantrila.com` | 308 redirect to `pantrila.com` | same project |
| `app.pantrila.com` | the web app | Vercel project `pantrila` (root `web/`) |
| `pantrila.vercel.app` | 308 redirect to `app.pantrila.com`, path kept | same project |
| `api.pantrila.com` | FastAPI | Render service `pantrio-api` |
| `send.pantrila.com` (DNS only) | sign-in email (SPF/DKIM) | Resend (or another mail service) |

The old addresses keep working until phase 5, so every phase before it can be rolled back by
pointing env vars back.

## Phase 0: move DNS to Vercel (owner, dashboards only)

Moving nameservers replaces every DNS record GoDaddy serves, so copy them first.

1. GoDaddy → My Products → pantrila.com → DNS: export or screenshot every record. Look for MX
   (email), TXT (SPF, Google/Microsoft verification), CNAMEs for email (`autodiscover`, `email`),
   and anything you set up yourself. GoDaddy's own parking records (`@` A to a parking IP,
   `www` CNAME to `pantrila.com`) can be dropped.
2. GoDaddy → DNS → DNSSEC: turn it off if it is on (a stale DS record breaks the domain after the
   switch). Turn it back on later at GoDaddy using Vercel's values only if you want it.
3. Vercel → Domains → Add `pantrila.com` to your account (not to a project yet). Recreate every
   record from step 1 that you want to keep in Vercel's DNS tab.
4. GoDaddy → Nameservers → "I'll use my own": `ns1.vercel-dns.com`, `ns2.vercel-dns.com`.
5. Wait for Vercel to show the domain as using its nameservers (usually under an hour, up to 48 h).
   Check with `dig NS pantrila.com +short`.

Nothing serves `pantrila.com` yet; that is expected.

## Phase 1: the app on app.pantrila.com and the API on api.pantrila.com (PR 1, small)

Dashboards (owner, or Claude through the Vercel/Render connectors where they allow it):

1. Render → `pantrio-api` → Settings → Custom Domains → add `api.pantrila.com`. Add the CNAME it
   asks for (`api` → `pantrio-api.onrender.com`) in Vercel DNS; wait for Render's certificate.
   Check: `curl https://api.pantrila.com/health`.
2. Render env: `PANTRILA_CORS_ORIGINS=https://app.pantrila.com,https://pantrila.vercel.app,http://localhost:3000`
   (old origin stays until phase 5).
3. Vercel project `pantrila` → Domains → add `app.pantrila.com` (Vercel adds the DNS record itself,
   since it now runs the DNS).
4. Vercel project `pantrila` env (Production): `NEXT_PUBLIC_API_URL=https://api.pantrila.com`, then
   redeploy (NEXT_PUBLIC values are baked in at build time).
5. Supabase → Auth → URL Configuration: Site URL `https://app.pantrila.com`; add
   `https://app.pantrila.com/auth/callback` to the redirect list; keep the `pantrila.vercel.app` ones.
6. Google Cloud → OAuth client: add `https://app.pantrila.com` to Authorised JavaScript origins.
   The redirect URI is Supabase's callback, so it does not change.
7. UptimeRobot: point the monitor at `https://api.pantrila.com/health`.

Code (PR 1):

- `src/pantrila/recipe_import.py` `USER_AGENT`: `+https://pantrila.com` (it still says
  `pantrio-azure.vercel.app`).
- `render.yaml`: comment for `PANTRILA_CORS_ORIGINS` names the new origin.
- `README.md`, `docs/demo-script.md`, `docs/google-sign-in.md`: new addresses; the Google doc gains
  the consent-screen steps from phase 5.
- `CLAUDE.md` Status and Layout.

Check on `app.pantrila.com`: Google sign-in, guest sign-in, a search, a chat turn, an import job,
a photo. Old `pantrila.vercel.app` still works throughout.

## Phase 2: landing site in `site/` (PR 2)

- Next.js App Router + Tailwind v4, fully static (no API calls, no Supabase). Tokens copied from
  `web/src/app/globals.css` and the logo from `web/src/app/icon.svg` / `web/brand/`, so it looks like
  the app. Copying beats a shared package for one small site; note the source in a comment.
- Sections: hero (one line on what Pantrila does, "Open Pantrila" → `https://app.pantrila.com`),
  features (assistant, weekly plan with deterministic allergen/diet checks, recipe import from
  links/photos/posts, cooking mode with voice and timers, pantry and grocery list), how the safety
  checks work, get the app (browser button, store badges marked "Coming soon"), footer with
  privacy, terms and contact. Screenshots from `docs/screenshots/`, retaken if stale.
- Metadata, Open Graph image, `sitemap.xml`, `robots.txt`, favicon and Apple icon reused.
- `/privacy` and `/terms`. The privacy page lists what is stored (profile, pantry, plans, chats,
  recipes, photos, usage), where (Supabase EU, Render, Vercel) and who processes it (OpenAI,
  Apify for social imports, Google sign-in, LangSmith traces, the mail service). Owner supplies the
  controller name and contact address; this is a draft, not legal advice.
- Vercel project `pantrila-site`, root `site/`, domains `pantrila.com` and `www.pantrila.com`
  (www redirects to the apex). Both projects get an Ignored Build Step
  (`git diff --quiet HEAD^ HEAD -- .`) so a change to one folder does not redeploy the other.
- CI: a `site` job running lint, typecheck and build, like the `web` job.
- The app's login page and account menu link to `pantrila.com/privacy` and `/terms`.

## Phase 3: sign-in email from pantrila.com (mostly dashboards, small PR)

1. Resend → Domains → add `send.pantrila.com` (a subdomain keeps sending reputation apart from any
   mailbox on the apex). Add its SPF, DKIM and MX records in Vercel DNS; add
   `_dmarc.pantrila.com` TXT `v=DMARC1; p=none; rua=mailto:<your inbox>` to start.
2. Supabase → Auth → SMTP: host `smtp.resend.com`, port 465, user `resend`, password a Resend API
   key limited to sending, sender `Pantrila <no-reply@send.pantrila.com>`. Raise the Auth email rate
   limit from its default to a sensible number (e.g. 30/hour).
3. Supabase → Auth → Email templates: Pantrila wording for the magic link (and confirm/change-email).
4. PR: login page copy no longer needs to play email down; `CLAUDE.md` Status loses the "built-in
   sender only emails the team" caveat.

Check: a magic link to an address outside the Supabase team arrives, is not in spam, and signs in.

## Phase 4: Google consent screen on the real domain (owner)

Google Cloud → OAuth consent screen: authorised domain `pantrila.com` (verified through Google
Search Console with a TXT record in Vercel DNS), home page `https://pantrila.com`, privacy
`https://pantrila.com/privacy`, terms `https://pantrila.com/terms`, app logo. Submit for
verification if Google asks (basic scopes usually only need brand verification).

## Phase 5: retire the old address (PR 3, small)

Only after phases 1-4 are checked.

- Redirect `pantrila.vercel.app/*` to `https://app.pantrila.com/*` (308). Vercel → project
  `pantrila` → Domains → edit `pantrila.vercel.app` → redirect, if the dashboard offers it for the
  `.vercel.app` domain; otherwise a host check at the top of `web/src/proxy.ts`.
- Guests: a guest's session lives in the browser storage of `pantrila.vercel.app`, which
  `app.pantrila.com` cannot read, so a guest who is redirected lands signed out and loses their
  guest data. Google users just sign in again. See open question 2.
- Render `PANTRILA_CORS_ORIGINS` and Supabase redirects drop the old origin after a few weeks.

## Order and rollback

0 → 1 → 2 → 3 → 4 → 5. Phases 2 and 3 do not depend on each other. Until phase 5, rolling back
phase 1 is setting `NEXT_PUBLIC_API_URL` back to `https://pantrio-api.onrender.com` and redeploying;
the old addresses never stop working.

## Open questions for the owner

1. Is there email on pantrila.com today (GoDaddy mailbox, Microsoft 365, forwarding)? Its MX/TXT
   records must be in Vercel DNS before the nameserver switch.
2. Guests on the old address: accept that unlinked guests start over (and show a "Keep your data
   with Google" banner on the old address for two weeks before redirecting), or build a one-time
   session hand-off to the new address?
3. Do you want an address that receives mail (e.g. `hello@pantrila.com` for the privacy page)?
   Vercel DNS has no mail forwarding, so that needs a mailbox or a forwarding service.
4. Name and contact to show as the data controller on the privacy page.

## Progress

- 2026-10-22, phase 0 done: GoDaddy held only parking records, a default `_dmarc` TXT and no MX, so
  nothing was copied. `pantrila.com` added to the personal Vercel account (mikegaucis-projects) with a
  Vercel DNS zone; nameservers switched to `ns1/ns2.vercel-dns.com` and confirmed at the registry.
- 2026-10-22, phase 1 dashboards done: `app.pantrila.com` on project `pantrila`; `api` CNAME to
  `pantrio-api.onrender.com` and Render custom domain (service `pantrila-api`); Render
  `PANTRILA_CORS_ORIGINS=https://app.pantrila.com,https://pantrila.vercel.app,https://pantrio-azure.vercel.app,http://localhost:3000`;
  Vercel `NEXT_PUBLIC_API_URL=https://api.pantrila.com` (all targets) and production redeployed;
  Supabase Site URL and redirect, Google origin added by the owner. Still to do: UptimeRobot URL.
- 2026-10-22, phase 2: `site/` landing page (home, `/privacy`, `/terms`, sitemap, robots, Open Graph
  image), screenshots retaken from the live app with a guest account (`site/public/screens/`), CI `site`
  job, Vercel project `pantrila-site` (root `site/`) with `pantrila.com` and `www` (308 to the apex).
  Production builds of both Vercel projects skip when their folder did not change
  (`[ "$VERCEL_ENV" = production ] && git diff --quiet HEAD^ HEAD -- .`); previews always build.
  The app's login page links to the terms and privacy pages. The privacy page names `hello@pantrila.com`
  as the contact, which does not receive mail until phase 3 sets up forwarding.
- 2026-10-22, owner answers: (1) no existing email; (3) `hello@pantrila.com` will be a FastComet mailbox
  (server `depro4.fcomet.com`, as for qtmdetailing.mt); (4) the operator is shown as "Pantrila". Added in
  Vercel DNS: MX `10 depro4.fcomet.com`, SPF `v=spf1 mx ip4:192.250.229.180 ip4:185.201.16.174
  include:spf.mysecurecloudhost.com ~all` (copied from qtmdetailing.mt), `_dmarc` `v=DMARC1; p=none;`.
  Still to do: add pantrila.com in FastComet cPanel, create the mailbox, add cPanel's DKIM record
  (`default._domainkey`) and compare its SPF. Phase 3's Resend records go on `send.pantrila.com`, so they do
  not touch this SPF. Open question 2: the owner accepts that unlinked guests on the old address start
  over.
- 2026-10-22, phase 3 started: Resend domain `send.pantrila.com` (eu-west-1, no tracking) and its DKIM,
  SPF, bounce MX and `rsend` CNAME records in Vercel DNS. Still to do (owner): a sending-only Resend key,
  Supabase SMTP settings and the email rate limit; then a magic-link test outside the Supabase team.
- 2026-10-22, phase 5: the Vercel API cannot set a redirect on a project domain, so `web/src/proxy.ts`
  sends `pantrila.vercel.app` and `pantrio-azure.vercel.app` to `https://app.pantrila.com` with a 308,
  keeping path and query (built assets are not matched). Render CORS drops the old origins after the
  redirect is live; the owner removes them from Supabase's redirect list.
- 2026-10-23, mailbox: pantrila.com added in FastComet cPanel (server `s13599.fra1.stableserver.net`,
  192.250.229.180, already in the SPF) and `hello@pantrila.com` created; cPanel's DKIM key published as
  `default._domainkey`; Email Deliverability shows Valid and the owner confirmed mail works.
- 2026-10-23, phase 3 done: Resend key "Pantrila Sending Access" (sending only), Supabase custom SMTP
  (`smtp.resend.com:465`, user `resend`, sender `no-reply@send.pantrila.com`), email rate limit 2/h -> 30/h.
  Test: a magic link to `hello@pantrila.com` (outside the Supabase team) delivered by Resend. A first try
  failed on a trailing comma in the SMTP host (`lookup smtp.resend.com,: no such host` in the auth log).
  A first email to a new address uses the "Confirm signup" template, later ones the "Magic link" one.
