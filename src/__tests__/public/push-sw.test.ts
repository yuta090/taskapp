import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import path from 'node:path'
import { isSafeInternalPath } from '@/lib/auth/safeRedirect'

// public/push-sw.js is a plain script (not part of the Next.js build, loaded
// directly via navigator.serviceWorker.register), so it is exercised here by
// evaluating its source against a minimal mock `self` service-worker global
// rather than importing it as a module.
const SW_SOURCE = readFileSync(
  path.resolve(__dirname, '../../../public/push-sw.js'),
  'utf-8'
)

interface FakeClient {
  url: string
  focus: () => void
  navigate: (url: string) => void
}

interface FakeSelf {
  location: { origin: string }
  registration: { showNotification: (title: string, options: unknown) => void }
  clients: {
    matchAll: () => Promise<FakeClient[]>
    openWindow: (url: string) => void
  }
  addEventListener: (type: string, cb: (event: unknown) => void) => void
  listeners: Record<string, (event: unknown) => void>
}

function loadServiceWorker(existingClients: FakeClient[] = []): FakeSelf {
  const listeners: FakeSelf['listeners'] = {}
  const fakeSelf: FakeSelf = {
    location: { origin: 'https://agentpm.app' },
    registration: { showNotification: () => {} },
    clients: {
      matchAll: async () => existingClients,
      openWindow: () => {},
    },
    addEventListener: (type, cb) => {
      listeners[type] = cb
    },
    listeners,
  }
  // vm's sandbox starts empty — the script uses the global `URL` constructor,
  // so it must be provided explicitly (Node exposes it globally, but a fresh
  // vm context does not inherit that).
  runInNewContext(SW_SOURCE, { self: fakeSelf, URL })
  return fakeSelf
}

function triggerNotificationClick(sw: FakeSelf, url: unknown): Promise<unknown> {
  let waited: Promise<unknown> = Promise.resolve()
  const event = {
    notification: { close: () => {}, data: { url } },
    waitUntil: (p: Promise<unknown>) => {
      waited = p
    },
  }
  sw.listeners.notificationclick(event)
  return waited
}

describe('push-sw.js notificationclick', () => {
  let openedUrl: string | null

  beforeEach(() => {
    openedUrl = null
  })

  it('opens an internal path', async () => {
    const sw = loadServiceWorker()
    sw.clients.openWindow = (url: string) => {
      openedUrl = url
    }
    await triggerNotificationClick(sw, '/inbox')
    expect(openedUrl).toBe('/inbox')
  })

  it('falls back to the app root for an absolute external URL', async () => {
    const sw = loadServiceWorker()
    sw.clients.openWindow = (url: string) => {
      openedUrl = url
    }
    await triggerNotificationClick(sw, 'https://evil.example.com')
    expect(openedUrl).toBe('/')
  })

  it('falls back to the app root for a protocol-relative URL', async () => {
    const sw = loadServiceWorker()
    sw.clients.openWindow = (url: string) => {
      openedUrl = url
    }
    await triggerNotificationClick(sw, '//evil.example.com')
    expect(openedUrl).toBe('/')
  })

  it('falls back to the app root for a javascript: URL', async () => {
    const sw = loadServiceWorker()
    sw.clients.openWindow = (url: string) => {
      openedUrl = url
    }
    await triggerNotificationClick(sw, 'javascript:alert(1)')
    expect(openedUrl).toBe('/')
  })

  it('falls back to the app root when there is no url at all', async () => {
    const sw = loadServiceWorker()
    sw.clients.openWindow = (url: string) => {
      openedUrl = url
    }
    await triggerNotificationClick(sw, undefined)
    expect(openedUrl).toBe('/')
  })

  it('navigates an already-open app window (not just openWindow) to a safe path', async () => {
    let navigatedUrl: string | null = null
    const client: FakeClient = {
      url: 'https://agentpm.app/inbox',
      focus: () => {},
      navigate: (url: string) => {
        navigatedUrl = url
      },
    }
    const sw = loadServiceWorker([client])
    await triggerNotificationClick(sw, '/org-1/project/space-1?task=t1')
    expect(navigatedUrl).toBe('/org-1/project/space-1?task=t1')
  })

  it('navigates an already-open app window to the app root for an unsafe url', async () => {
    let navigatedUrl: string | null = null
    const client: FakeClient = {
      url: 'https://agentpm.app/inbox',
      focus: () => {},
      navigate: (url: string) => {
        navigatedUrl = url
      },
    }
    const sw = loadServiceWorker([client])
    await triggerNotificationClick(sw, 'https://evil.example.com')
    expect(navigatedUrl).toBe('/')
  })

  // Drift detection: the service worker duplicates isSafeInternalPath
  // (src/lib/auth/safeRedirect.ts) because it is plain JS outside the Next.js
  // build. This runs the same inputs through both and requires the same
  // verdict, so the two can never quietly disagree.
  describe('agrees with isSafeInternalPath (src/lib/auth/safeRedirect.ts) on every input', () => {
    const CASES: ReadonlyArray<unknown> = [
      '/inbox',
      '/org-1/project/space-1?task=t1&x=1#h',
      '/日本語',
      '//evil.example',
      'https://evil.example',
      '/\\evil.example',
      '/evil/path\\with-backslash',
      '/\t/evil.example',
      '/\n/evil.example',
      '/\x00evil',
      '/\x7f',
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      ' //evil.example',
      'inbox',
      '',
      '/..//evil.example',
      '/.//evil.example',
      '/%2e%2e//evil.example',
      undefined,
      null,
    ]

    for (const input of CASES) {
      it(`input=${JSON.stringify(input)}`, async () => {
        const expectedSafe = isSafeInternalPath(input as string | null | undefined)

        let openedUrl2: string | null = null
        const sw = loadServiceWorker()
        sw.clients.openWindow = (url: string) => {
          openedUrl2 = url
        }
        await triggerNotificationClick(sw, input)

        expect(openedUrl2).toBe(expectedSafe ? input : '/')
      })
    }
  })
})
