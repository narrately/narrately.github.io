// Supabase Edge Function. Deploy with:
//   supabase functions deploy stripe-webhook --no-verify-jwt
// (--no-verify-jwt because Stripe calls this directly, not with a Supabase JWT —
// it's authenticated instead via the Stripe signature check below.)
// Secrets needed: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY
//
// Point a Stripe webhook at this function's URL for:
//   checkout.session.completed, customer.subscription.updated, customer.subscription.deleted
import Stripe from 'npm:stripe@17';
import { createClient } from 'npm:@supabase/supabase-js@2';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2024-06-20' });
const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')!;
const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

Deno.serve(async (req) => {
  const signature = req.headers.get('stripe-signature');
  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature!, webhookSecret);
  } catch (err) {
    return new Response(`webhook signature verification failed: ${(err as Error).message}`, { status: 400 });
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const orgId = session.metadata?.org_id;
      if (orgId) {
        await admin.from('orgs').update({ subscription_status: 'active' }).eq('id', orgId);
      }
      break;
    }
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription;
      const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
      const status = sub.status === 'active' || sub.status === 'trialing' ? sub.status : 'canceled';
      await admin.from('orgs').update({ subscription_status: status }).eq('stripe_customer_id', customerId);
      break;
    }
  }

  return new Response(JSON.stringify({ received: true }), { headers: { 'content-type': 'application/json' } });
});
