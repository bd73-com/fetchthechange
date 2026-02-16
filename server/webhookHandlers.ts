import Stripe from 'stripe';
import { getStripeSync, getUncachableStripeClient, getWebhookSecret } from './stripeClient';
import { authStorage } from './replit_integrations/auth/storage';
import { ErrorLogger } from './services/logger';
import { type UserTier, TIER_LIMITS } from '@shared/models/auth';

const VALID_TIERS = new Set<UserTier>(Object.keys(TIER_LIMITS) as UserTier[]);
const isUserTier = (value: string): value is UserTier => VALID_TIERS.has(value as UserTier);

/**
 * Determines user tier from a Stripe product.
 * Priority: explicit metadata.tier > name containing 'power' > name containing 'pro' > 'free'.
 * 'power' is checked before 'pro' so a product like "Professional Power" resolves to 'power'.
 */
export function determineTierFromProduct(product: { metadata?: Record<string, string> | null; name?: string; id?: string }): UserTier {
  const tier = product.metadata?.tier;
  if (tier && isUserTier(tier)) {
    return tier;
  }

  const name = product.name?.toLowerCase() ?? '';
  if (name.includes('power')) {
    return 'power';
  }
  if (name.includes('pro')) {
    return 'pro';
  }

  console.warn(`[Stripe] Could not determine tier for product ${product.id}, defaulting to free`);
  return 'free';
}

export class WebhookHandlers {
  static async processWebhook(payload: Buffer, signature: string): Promise<void> {
    if (!Buffer.isBuffer(payload)) {
      throw new Error(
        'STRIPE WEBHOOK ERROR: Payload must be a Buffer. ' +
        'Received type: ' + typeof payload + '. ' +
        'This usually means express.json() parsed the body before reaching this handler. ' +
        'FIX: Ensure webhook route is registered BEFORE app.use(express.json()).'
      );
    }

    const secret = getWebhookSecret();
    if (!secret) {
      throw new Error(
        'Stripe webhook secret is not configured. ' +
        'Set STRIPE_WEBHOOK_SECRET or ensure managed webhook creation succeeds.'
      );
    }

    // Verify signature ourselves before trusting the payload
    const stripe = await getUncachableStripeClient();
    const event = stripe.webhooks.constructEvent(payload, signature, secret);

    // Now that signature is verified, let StripeSync process for DB syncing
    const sync = await getStripeSync();
    await sync.processWebhook(payload, signature);

    await WebhookHandlers.handleStripeEvent(event);
  }

  static async handleStripeEvent(event: any): Promise<void> {
    console.log(`[Stripe Webhook] Processing event: ${event.type}`);

    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await WebhookHandlers.handleSubscriptionChange(event.data.object);
        break;
      case 'customer.subscription.deleted':
        await WebhookHandlers.handleSubscriptionDeleted(event.data.object);
        break;
      default:
        console.log(`[Stripe Webhook] Unhandled event type: ${event.type}`);
    }
  }

  static async handleSubscriptionChange(subscription: any): Promise<void> {
    const customerId = subscription.customer;
    const status = subscription.status;
    const priceId = subscription.items?.data?.[0]?.price?.id;

    console.log(`[Stripe] Subscription change: customer=${customerId}, status=${status}, priceId=${priceId}`);

    const user = await authStorage.getUserByStripeCustomerId(customerId);
    if (!user) {
      console.log(`[Stripe] No user found for customer ${customerId}`);
      return;
    }

    // For inactive subscriptions, downgrade to free
    if (status !== 'active' && status !== 'trialing') {
      await authStorage.updateUser(user.id, {
        tier: 'free',
        stripeSubscriptionId: subscription.id,
      });
      console.log(`[Stripe] User ${user.id} subscription inactive, set to free tier`);
      return;
    }

    // Guard: if no priceId available, log warning and skip tier update
    if (!priceId) {
      console.warn(`[Stripe] No priceId found for subscription ${subscription.id}, skipping tier update`);
      // Still update subscription ID but don't change tier
      await authStorage.updateUser(user.id, {
        stripeSubscriptionId: subscription.id,
      });
      return;
    }

    let newTier: UserTier = 'free';

    try {
      const stripe = await getUncachableStripeClient();
      const price = await stripe.prices.retrieve(priceId, { expand: ['product'] });
      const product = price.product as any;
      newTier = determineTierFromProduct(product);
    } catch (error: any) {
      await ErrorLogger.error("stripe", `Error retrieving price ${priceId}`, error instanceof Error ? error : null, { customerId, priceId, subscriptionId: subscription.id });
      await authStorage.updateUser(user.id, {
        stripeSubscriptionId: subscription.id,
      });
      return;
    }

    await authStorage.updateUser(user.id, {
      tier: newTier,
      stripeSubscriptionId: subscription.id,
    });

    console.log(`[Stripe] Updated user ${user.id} to tier: ${newTier}`);
  }

  static async handleSubscriptionDeleted(subscription: any): Promise<void> {
    const customerId = subscription.customer;

    const user = await authStorage.getUserByStripeCustomerId(customerId);
    if (!user) {
      console.log(`[Stripe] No user found for customer ${customerId}`);
      return;
    }

    await authStorage.updateUser(user.id, {
      tier: 'free',
      stripeSubscriptionId: null,
    });

    console.log(`[Stripe] User ${user.id} downgraded to free tier`);
  }
}
