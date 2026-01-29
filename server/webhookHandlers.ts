import { getStripeSync, getUncachableStripeClient } from './stripeClient';
import { authStorage } from './replit_integrations/auth/storage';
import type { UserTier } from '@shared/models/auth';

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

    const sync = await getStripeSync();
    
    // StripeSync.processWebhook validates signature internally before processing
    // This ensures only verified events are ingested into the database
    await sync.processWebhook(payload, signature);

    // Parse event for our custom business logic (tier updates)
    // We use JSON.parse since signature was already verified by StripeSync
    const event = JSON.parse(payload.toString());

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
      
      if (product.metadata?.tier) {
        newTier = product.metadata.tier as UserTier;
      } else if (product.name?.toLowerCase().includes('power')) {
        newTier = 'power';
      } else if (product.name?.toLowerCase().includes('pro')) {
        newTier = 'pro';
      } else {
        console.warn(`[Stripe] Could not determine tier for product ${product.id}, defaulting to free`);
      }
    } catch (error: any) {
      console.error(`[Stripe] Error retrieving price ${priceId}:`, error.message);
      // Don't update tier if we can't determine it
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
