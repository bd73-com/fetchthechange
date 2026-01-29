/**
 * Seed script to create Stripe products and prices for FetchTheChange tiers
 * 
 * Run with: npx tsx scripts/seed-stripe-products.ts
 * 
 * This creates:
 * - Pro Plan: $9/month - 100 monitors
 * - Power Plan: $29/month - Unlimited monitors
 */

import { getUncachableStripeClient } from '../server/stripeClient';

async function seedProducts() {
  console.log('Connecting to Stripe...');
  const stripe = await getUncachableStripeClient();
  console.log('Connected to Stripe');

  // Check if products already exist
  const existingProducts = await stripe.products.search({
    query: "name:'Pro Plan' OR name:'Power Plan'",
  });

  if (existingProducts.data.length > 0) {
    console.log('Products already exist:');
    for (const product of existingProducts.data) {
      console.log(`  - ${product.name} (${product.id})`);
    }
    console.log('Skipping creation. Delete existing products in Stripe Dashboard to recreate.');
    return;
  }

  // Create Pro Plan product
  console.log('Creating Pro Plan...');
  const proProduct = await stripe.products.create({
    name: 'Pro Plan',
    description: 'Monitor up to 100 web pages for changes. Perfect for professionals and small businesses.',
    metadata: {
      tier: 'pro',
      monitor_limit: '100',
    },
  });

  const proPrice = await stripe.prices.create({
    product: proProduct.id,
    unit_amount: 900, // $9.00
    currency: 'usd',
    recurring: { interval: 'month' },
    metadata: {
      tier: 'pro',
    },
  });

  console.log(`  Created Pro Plan: ${proProduct.id}`);
  console.log(`  Pro Price: ${proPrice.id} ($9/month)`);

  // Create Power Plan product
  console.log('Creating Power Plan...');
  const powerProduct = await stripe.products.create({
    name: 'Power Plan',
    description: 'Unlimited web page monitoring. Ideal for agencies and power users.',
    metadata: {
      tier: 'power',
      monitor_limit: 'unlimited',
    },
  });

  const powerPrice = await stripe.prices.create({
    product: powerProduct.id,
    unit_amount: 2900, // $29.00
    currency: 'usd',
    recurring: { interval: 'month' },
    metadata: {
      tier: 'power',
    },
  });

  console.log(`  Created Power Plan: ${powerProduct.id}`);
  console.log(`  Power Price: ${powerPrice.id} ($29/month)`);

  console.log('\nProducts created successfully!');
  console.log('These will sync to your database automatically via webhooks.');
}

seedProducts().catch(console.error);
