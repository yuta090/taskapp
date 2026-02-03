'use client'

import { loadStripe, Stripe } from '@stripe/stripe-js'

// クライアントサイド用Stripeインスタンス（遅延初期化）
let stripePromise: Promise<Stripe | null> | null = null

export function getStripeClient(): Promise<Stripe | null> {
  if (!stripePromise) {
    const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
    if (!publishableKey) {
      console.warn('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is not configured')
      return Promise.resolve(null)
    }
    stripePromise = loadStripe(publishableKey)
  }
  return stripePromise
}

// Checkoutセッションにリダイレクト
// Stripe Checkout URLを直接使用する方式（推奨）
export async function redirectToCheckout(checkoutUrl: string): Promise<void> {
  window.location.href = checkoutUrl
}

// Stripe.jsを使用したリダイレクト（セッションIDを使用）
export async function redirectToCheckoutWithSessionId(sessionId: string): Promise<void> {
  const stripe = await getStripeClient()
  if (!stripe) {
    throw new Error('Stripe is not configured')
  }

  // @ts-expect-error - Stripe.js v3 API
  const result = await stripe.redirectToCheckout({ sessionId })
  if (result?.error) {
    throw new Error(result.error.message)
  }
}
