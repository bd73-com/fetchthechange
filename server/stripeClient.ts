import Stripe from 'stripe';

// Uses environment variables for Stripe API keys
// Set STRIPE_SECRET_KEY and STRIPE_PUBLISHABLE_KEY in your secrets
const SECRET_KEY_PREFIX = /^sk_(live|test)_/;
const PUBLISHABLE_KEY_PREFIX = /^pk_(live|test)_/;

function getCredentials() {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY;

  if (!secretKey || !publishableKey) {
    throw new Error(
      'Stripe API keys not found. Please set STRIPE_SECRET_KEY and STRIPE_PUBLISHABLE_KEY in your secrets.'
    );
  }

  if (!SECRET_KEY_PREFIX.test(secretKey)) {
    throw new Error(
      'Invalid STRIPE_SECRET_KEY format. Must start with sk_live_ or sk_test_.'
    );
  }

  if (!PUBLISHABLE_KEY_PREFIX.test(publishableKey)) {
    throw new Error(
      'Invalid STRIPE_PUBLISHABLE_KEY format. Must start with pk_live_ or pk_test_.'
    );
  }

  return {
    publishableKey,
    secretKey,
  };
}

export async function getUncachableStripeClient() {
  const { secretKey } = getCredentials();

  return new Stripe(secretKey, {
    apiVersion: '2025-11-17.clover',
  });
}

export async function getStripePublishableKey() {
  const { publishableKey } = getCredentials();
  return publishableKey;
}

export async function getStripeSecretKey() {
  const { secretKey } = getCredentials();
  return secretKey;
}

let stripeSync: any = null;

/** Webhook signing secret — set from STRIPE_WEBHOOK_SECRET env or managed webhook creation. */
let webhookSecret: string | null = process.env.STRIPE_WEBHOOK_SECRET ?? null;

export function getWebhookSecret(): string | null {
  return webhookSecret;
}

export function setWebhookSecret(secret: string): void {
  webhookSecret = secret;
  // Invalidate cached StripeSync so it re-initializes with the new secret
  stripeSync = null;
}

export async function getStripeSync() {
  if (!stripeSync) {
    const { StripeSync } = await import('stripe-replit-sync');
    const secretKey = await getStripeSecretKey();

    stripeSync = new StripeSync({
      poolConfig: {
        connectionString: process.env.DATABASE_URL!,
        max: 2,
      },
      stripeSecretKey: secretKey,
      ...(webhookSecret ? { stripeWebhookSecret: webhookSecret } : {}),
    });
  }
  return stripeSync;
}
