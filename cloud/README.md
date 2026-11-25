# Narrately Cloud (team rollup — paid tier)

Opt-in. The CLI and local dashboard work fully offline without any of this.

## Setup (one-time, done by whoever runs the Supabase project)

1. Create a project at https://supabase.com/dashboard
2. Open the SQL editor, paste all of `cloud/schema.sql`, run it.
   Re-run the whole file after every update — it is idempotent and upgrades
   an existing project in place.
3. Project Settings → API: copy the Project URL and the `anon` public key
4. Set them wherever the CLI runs (only needed for `signup` / `login` — the
   CLI remembers the project after that, so the daemon syncs without them):
   ```bash
   export NARRATELY_CLOUD_URL=https://xxxx.supabase.co
   export NARRATELY_CLOUD_ANON_KEY=eyJ...
   ```
5. For the hosted dashboard, copy `cloud/dashboard/config.example.js` to
   `config.js` with the same two values and serve the folder statically.

## Team owner

```bash
narrately cloud signup              # once, then confirm the email
narrately cloud login
narrately cloud create-org "Acme"   # you become the owner; 14-day trial starts
narrately cloud invite              # prints a join code, valid 7 days
```

Owners can also create invites and remove members from the dashboard.
`narrately cloud dashboard` opens it locally at http://127.0.0.1:5544 — no
`config.js` needed, it uses the project you logged in to.

## Each teammate

```bash
narrately cloud signup              # once, then confirm the email
narrately cloud login
narrately cloud join <code>
```

Managers who don't use the CLI can sign up and join from the dashboard instead.

## Syncing

While `narrately daemon` runs, it pushes session metadata every 15 minutes.
`narrately sync` pushes immediately; `narrately sync --days 30` re-sends a
longer window. Sessions are rebuilt from raw events on each sync, so nothing
depends on `narrately report` having run.

Turn automatic sync off with `narrately config set cloud.auto_sync false`
(restart the daemon afterwards).

Other commands: `narrately cloud members`, `narrately cloud org` (list or
switch teams), `narrately cloud status`, `narrately cloud logout`.

## What gets sent

Only session metadata: project label, start/end time, duration, language
list, save/edit counts, lines added/removed.

Never sent: file paths, diffs, commit messages, notes, or any code content —
those stay in `~/.narrately/narrately.db` and never leave the machine, same
as the free CLI.

## Billing (Stripe)

New orgs get a 14-day trial (`orgs.trial_ends_at`). After it ends, or if a
subscription is canceled, teams keep read access to past rollups but new
syncs are blocked until the owner upgrades. `past_due` keeps syncing while
Stripe retries the card.

1. Create a Stripe account, then a Product with a recurring Price (e.g. $10/seat/month).
   Checkout bills one seat per current member.
2. Install the Supabase CLI, then link this project:
   ```bash
   npx supabase login
   npx supabase link --project-ref <your-project-ref>
   ```
3. Set secrets (from Stripe dashboard → Developers → API keys):
   ```bash
   npx supabase secrets set \
     STRIPE_SECRET_KEY=sk_live_... \
     STRIPE_PRICE_ID=price_... \
     NARRATELY_DASHBOARD_URL=https://your-dashboard-domain
   ```
   `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are
   provided to edge functions automatically — don't set them (the CLI skips
   names starting with `SUPABASE_`). The service-role / secret key bypasses RLS
   entirely, so it must never go in the CLI, the dashboard, or a chat.
   `NARRATELY_DASHBOARD_URL` must be the exact origin the dashboard is served
   from — it is the CORS allow-origin.
4. Deploy the functions:
   ```bash
   npx supabase functions deploy create-checkout-session
   npx supabase functions deploy stripe-webhook --no-verify-jwt
   ```
5. In Stripe dashboard → Developers → Webhooks, add an endpoint pointing at:
   `https://<project-ref>.functions.supabase.co/stripe-webhook`
   Subscribe it to: `checkout.session.completed`, `customer.subscription.updated`,
   `customer.subscription.deleted`. Copy the signing secret and set it too:
   ```bash
   npx supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
   ```

The dashboard's "Upgrade team plan" button (owners only) calls
`create-checkout-session` and redirects to Stripe Checkout. The webhook flips
`orgs.subscription_status` when payment completes or a subscription changes.

Seat count is set at checkout; members who join later aren't added to the
Stripe quantity automatically yet.
