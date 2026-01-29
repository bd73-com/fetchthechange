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
    await sync.processWebhook(payload, signature);

    const stripe = await getUncachableStripeClient();
    const event = stripe.webhooks.constructEvent(
      payload,
      signature,
      (await sync.getWebhookSecret())
    );

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

    let newTier: UserTier = 'free';
    
    if (status === 'active' || status === 'trialing') {
      const stripe = await getUncachableStripeClient();
      const price = await stripe.prices.retrieve(priceId, { expand: ['product'] });
      const product = price.product as any;
      
      if (product.metadata?.tier) {
        newTier = product.metadata.tier as UserTier;
      } else if (product.name?.toLowerCase().includes('power')) {
        newTier = 'power';
      } else if (product.name?.toLowerCase().includes('pro')) {
        newTier = 'pro';
      }
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
