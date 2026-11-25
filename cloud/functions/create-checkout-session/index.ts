// Supabase Edge Function. Deploy with:
//   supabase functions deploy create-checkout-session
// Secrets needed (supabase secrets set ...): STRIPE_SECRET_KEY, STRIPE_PRICE_ID,
// SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, NARRATELY_DASHBOARD_URL
//
// Called by the dashboard with the logged-in user's JWT. Creates (or reuses) a
// Stripe customer for the org and returns a Checkout Session URL to redirect to.
import Stripe from 'npm:stripe@17';
import { createClient } from 'npm:@supabase/supabase-js@2';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2024-06-20' });
const PRICE_ID = Deno.env.get('STRIPE_PRICE_ID')!;
const SITE_URL = Deno.env.get('NARRATELY_DASHBOARD_URL') ?? 'http://127.0.0.1:5544';

// The dashboard is served from its own origin and sends an Authorization
// header, so the browser preflights every call — without these headers on
// the OPTIONS reply (and the real one) the Upgrade button can never connect.
const CORS = {
  'Access-Control-Allow-Origin': SITE_URL,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(payload: unknown, status: number) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'missing auth' }, 401);

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return json({ error: 'unauthorized' }, 401);

  let body: { org_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid JSON' }, 400);
  }
  if (!body.org_id) return json({ error: 'org_id required' }, 400);

  // Billing is an owner action. is_org_owner() runs against the caller's JWT,
  // so this is the authorization check for "can this user bill this org".
  const { data: isOwner } = await supabase.rpc('is_org_owner', { check_org_id: body.org_id });
  if (!isOwner) return json({ error: 'only the team owner can manage billing' }, 403);

  const { data: org, error: orgError } = await supabase
    .from('orgs')
    .select('id, stripe_customer_id')
    .eq('id', body.org_id)
    .single();
  if (orgError || !org) return json({ error: 'org not found' }, 404);

  // Owners can read every membership row of their org, so this counts seats.
  const { count: seats } = await supabase
    .from('memberships')
    .select('user_id', { count: 'exact', head: true })
    .eq('org_id', body.org_id);

  let customerId = org.stripe_customer_id as string | null;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: userData.user.email,
      metadata: { org_id: body.org_id },
    });
    customerId = customer.id;

    // Anon client has no update policy on orgs (by design) — write the
    // customer id back with the service-role key, server-side only.
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    await admin.from('orgs').update({ stripe_customer_id: customerId }).eq('id', body.org_id);
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: PRICE_ID, quantity: Math.max(1, seats ?? 1) }],
    success_url: `${SITE_URL}/?billing=success`,
    cancel_url: `${SITE_URL}/?billing=cancelled`,
    metadata: { org_id: body.org_id },
  });

  return json({ url: session.url }, 200);
});
