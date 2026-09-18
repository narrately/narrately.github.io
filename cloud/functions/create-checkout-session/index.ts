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

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return new Response('missing auth', { status: 401 });

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return new Response('unauthorized', { status: 401 });

  let body: { org_id?: string };
  try {
    body = await req.json();
  } catch {
    return new Response('invalid JSON', { status: 400 });
  }
  if (!body.org_id) return new Response('org_id required', { status: 400 });

  // RLS on `orgs` only allows this select if the caller is a member — that IS
  // the authorization check for "can this user bill this org".
  const { data: org, error: orgError } = await supabase
    .from('orgs')
    .select('id, stripe_customer_id')
    .eq('id', body.org_id)
    .single();
  if (orgError || !org) return new Response('org not found or not a member', { status: 404 });

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
    line_items: [{ price: PRICE_ID, quantity: 1 }],
    success_url: `${SITE_URL}/?billing=success`,
    cancel_url: `${SITE_URL}/?billing=cancelled`,
    metadata: { org_id: body.org_id },
  });

  return new Response(JSON.stringify({ url: session.url }), {
    headers: { 'content-type': 'application/json' },
  });
});
