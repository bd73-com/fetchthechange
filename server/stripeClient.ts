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

const STRIPE_SYNC_INIT_TIMEOUT_MS = 15_000;

let stripeSync: any = null;
let stripeSyncPending: Promise<any> | null = null;
let stripeSyncShuttingDown = false;

/** Webhook signing secret — set from STRIPE_WEBHOOK_SECRET env or managed webhook creation. */
let webhookSecret: string | null = process.env.STRIPE_WEBHOOK_SECRET ?? null;

export function getWebhookSecret(): string | null {
  return webhookSecret;
}

export function setWebhookSecret(secret: string): void {
  webhookSecret = secret;
}

export async function getStripeSync() {
  if (stripeSyncShuttingDown) {
    throw new Error('StripeSync is shutting down — cannot acquire new instance');
  }
  if (stripeSync) {
    return stripeSync;
  }
  if (!stripeSyncPending) {
    let timer: ReturnType<typeof setTimeout>;
    stripeSyncPending = Promise.race([
      (async () => {
        const { StripeSync } = await import('stripe-replit-sync');
        const secretKey = await getStripeSecretKey();

        return new StripeSync({
          poolConfig: {
            connectionString: process.env.DATABASE_URL!,
            max: 1,
            connectionTimeoutMillis: 5_000,
            idleTimeoutMillis: 15_000,
          },
          stripeSecretKey: secretKey,
          ...(webhookSecret ? { stripeWebhookSecret: webhookSecret } : {}),
        });
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('StripeSync initialization timed out')), STRIPE_SYNC_INIT_TIMEOUT_MS);
      }),
    ]).then((result) => {
      clearTimeout(timer);
      if (!stripeSyncShuttingDown) {
        stripeSync = result;
      }
      return result;
    }).catch((err) => {
      clearTimeout(timer);
      stripeSync = null;
      stripeSyncPending = null;
      throw err;
    });
  }
  return stripeSyncPending;
}

/** Close the StripeSync database pool if it was initialized. */
export async function closeStripeSync(): Promise<void> {
  stripeSyncShuttingDown = true;
  let pendingResult: any = null;
  if (stripeSyncPending) {
    try { pendingResult = await stripeSyncPending; } catch { /* initialization may have failed */ }
  }
  stripeSyncPending = null;
  // Close either the cached singleton or the just-resolved pending result
  const instanceToClose = stripeSync ?? pendingResult;
  stripeSync = null;
  if (instanceToClose) {
    await instanceToClose.postgresClient?.pool?.end();
  }
}
