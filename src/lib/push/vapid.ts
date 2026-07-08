/**
 * Converts a URL-safe base64 VAPID public key (as returned by web-push /
 * stored in NEXT_PUBLIC_VAPID_PUBLIC_KEY) into the Uint8Array format required
 * by PushManager.subscribe's applicationServerKey option.
 */
export function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const base64Safe = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')

  const rawData = atob(base64Safe)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}
