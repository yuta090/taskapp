// Web Push service worker. Plain JS, not part of the Next.js build —
// registered directly via navigator.serviceWorker.register('/push-sw.js').

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = {}
  }

  event.waitUntil(
    self.registration.showNotification(data.title || '通知', {
      body: data.body,
      tag: data.tag,
      data: { url: data.url },
    })
  )
})

// Only ever navigate to an app-internal path. This mirrors
// src/lib/auth/safeRedirect.ts (isSafeInternalPath), duplicated here because
// this file is plain JS served as-is (not part of the Next.js build) and
// cannot import it — keep the two in sync.
function isSafeInternalPath(path) {
  if (typeof path !== 'string' || path.length === 0) {
    return false
  }
  if (!path.startsWith('/') || path.startsWith('//')) {
    return false
  }
  if (path.includes('\\') || /[\x00-\x1f\x7f]/.test(path)) {
    return false
  }
  try {
    const u = new URL(path, self.location.origin)
    if (u.origin !== self.location.origin) {
      return false
    }
    // Also reject a resolved path starting with `//`, so the path part alone
    // can never be read as a different host.
    if (u.pathname.startsWith('//')) {
      return false
    }
    return true
  } catch {
    return false
  }
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const rawUrl = event.notification.data && event.notification.data.url
  const url = isSafeInternalPath(rawUrl) ? rawUrl : '/'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        const clientUrl = new URL(client.url)
        if (clientUrl.origin === self.location.origin && 'focus' in client) {
          client.focus()
          if ('navigate' in client) {
            return client.navigate(url)
          }
          return
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(url)
      }
    })
  )
})
