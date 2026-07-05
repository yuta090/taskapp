'use client'

/**
 * Best-effort Web Push cleanup, called right before signOut(). Prevents a
 * stale push_subscriptions row from surviving a logout and delivering the
 * previous user's notifications to whoever logs in next on a shared browser
 * (the server-side half — ownership transfer on re-subscribe — lives in
 * /api/push/subscribe).
 *
 * Uses register() (idempotent: returns the existing registration if one is
 * already installed) rather than navigator.serviceWorker.ready, because
 * `ready` never resolves unless a service worker is already controlling the
 * page — which is not the case for a user who logs out without ever having
 * opened the push-notification settings screen. `ready` would hang the
 * logout flow indefinitely for that user; register() resolves immediately.
 *
 * Every step is wrapped so failures are logged, never thrown — logout must
 * never be blocked by push cleanup.
 */
export async function cleanupPushOnLogout(): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return

  try {
    const registration = await navigator.serviceWorker.register('/push-sw.js')
    const subscription = await registration.pushManager.getSubscription()
    if (!subscription) return

    const endpoint = subscription.endpoint

    try {
      await fetch('/api/push/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint }),
      })
    } catch (err) {
      console.warn('[cleanupPushOnLogout] Failed to unsubscribe on server:', err)
    }

    try {
      await subscription.unsubscribe()
    } catch (err) {
      console.warn('[cleanupPushOnLogout] Failed to unsubscribe locally:', err)
    }
  } catch (err) {
    console.warn('[cleanupPushOnLogout] Push cleanup failed:', err)
  }
}
