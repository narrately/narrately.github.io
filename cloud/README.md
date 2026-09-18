# Narrately Cloud (team rollup — paid tier)

Opt-in. The CLI and local dashboard work fully offline without any of this.

## Setup (one-time, done by whoever owns the team account)

1. Create a project at https://supabase.com/dashboard
2. Open the SQL editor, paste `cloud/schema.sql`, run it
3. Project Settings → API: copy the Project URL and the `anon` public key
4. Set them wherever the CLI runs:
   ```bash
   export NARRATELY_CLOUD_URL=https://xxxx.supabase.co
   export NARRATELY_CLOUD_ANON_KEY=eyJ...
   ```
5. In the Supabase SQL editor, create the org row and note its id:
   ```sql
   insert into orgs (name) values ('Acme Team') returning id;
   ```

## Per-member setup

```bash
narrately cloud signup      # once, then confirm the email
narrately cloud login
narrately cloud org <org-id-from-step-5>
narrately sync              # push session metadata now
```

Add `narrately sync` to a cron job / scheduled task to keep it current — it only
pushes rows newer than the last successful sync (tracked in the local db).

## What gets sent

Only rows shaped like `sessions` in the local db: project label, start/end
time, duration, language list, save/edit counts, lines added/removed.

Never sent: file paths, diffs, commit messages, notes, or any code content —
those stay in `~/.narrately/narrately.db` and never leave the machine, same
as the free CLI.

## Membership

An org owner adds members with:

```sql
insert into memberships (user_id, org_id, role) values ('<user-uuid>', '<org-id>', 'member');
```

(`user_id` comes from `auth.users` after that person runs `narrately cloud signup`.)

## Billing (Stripe)

New orgs default to `subscription_status = 'trialing'` — sync works immediately,
nothing breaks before Stripe is wired up. Once wired, lapsed/canceled orgs keep
read access to past rollups but new `narrately sync` writes are blocked by RLS
until they upgrade.

1. Create a Stripe account, then a Product with a recurring Price (e.g. $10/seat/month)
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
     SUPABASE_URL=https://xxxx.supabase.co \
     SUPABASE_ANON_KEY=eyJ... \
     SUPABASE_SERVICE_ROLE_KEY=eyJ...  \
     NARRATELY_DASHBOARD_URL=https://your-dashboard-domain
   ```
   (`SUPABASE_SERVICE_ROLE_KEY` is in Project Settings → API — keep it secret,
   it bypasses RLS entirely. It only ever lives in these edge function secrets,
   never in the CLI or dashboard.)
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

The dashboard's "Upgrade team plan" button calls `create-checkout-session` and
redirects to Stripe Checkout. The webhook flips `orgs.subscription_status` when
payment completes or a subscription changes.
