import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * SSRF共有バリデータ（AI_SECRETARY_STAGE3_INTEGRATIONS.md §2-3）。
 * 登録時(POST/PATCH)・test配達・本配送の3経路すべてがこのモジュールの関数を通る前提。
 * dns.lookup をモックして deny 対象IPの網羅性を検証する。
 */

const lookupMock = vi.fn()
vi.mock('node:dns/promises', () => ({
  default: { lookup: (...args: unknown[]) => lookupMock(...args) },
  lookup: (...args: unknown[]) => lookupMock(...args),
}))

const { validateWebhookUrl, isDeniedIp } = await import('@/lib/sinks/ssrf')

function mockDns(addresses: Array<{ address: string; family: 4 | 6 }>) {
  lookupMock.mockResolvedValue(addresses)
}

describe('isDeniedIp', () => {
  it.each([
    ['127.0.0.1', 'loopback'],
    ['10.0.0.1', 'private 10/8'],
    ['172.16.0.5', 'private 172.16/12'],
    ['192.168.1.1', 'private 192.168/16'],
    ['169.254.169.254', 'metadata (link-local)'],
    ['0.0.0.0', 'unspecified'],
    ['100.64.0.1', 'CGNAT'],
    ['192.0.0.1', 'reserved 192.0.0.0/24'],
    ['224.0.0.1', 'multicast'],
    ['255.255.255.255', 'broadcast/reserved'],
    ['::1', 'IPv6 loopback'],
    ['fc00::1', 'IPv6 ULA'],
    ['fe80::1', 'IPv6 link-local'],
    ['ff00::1', 'IPv6 multicast'],
    ['::ffff:169.254.169.254', 'IPv4-mapped IPv6 metadata'],
    ['::ffff:127.0.0.1', 'IPv4-mapped IPv6 loopback'],
    ['fd00:ec2::254', 'AWS IMDSv6 metadata (ULA)'],
    ['::', 'unspecified IPv6'],
  ])('%s (%s) is denied', (ip) => {
    expect(isDeniedIp(ip)).toBe(true)
  })

  it.each([
    ['8.8.8.8', 'public IPv4'],
    ['1.1.1.1', 'public IPv4'],
    ['2001:4860:4860::8888', 'public IPv6'],
  ])('%s (%s) is allowed', (ip) => {
    expect(isDeniedIp(ip)).toBe(false)
  })

  it('unparsable input is denied (fail closed)', () => {
    expect(isDeniedIp('not-an-ip')).toBe(true)
  })
})

describe('validateWebhookUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects non-https protocol', async () => {
    const result = await validateWebhookUrl('http://example.com/hook')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('https_required')
  })

  it('rejects invalid URLs', async () => {
    const result = await validateWebhookUrl('not a url')
    expect(result.ok).toBe(false)
  })

  it('rejects non-443 ports', async () => {
    const result = await validateWebhookUrl('https://example.com:8443/hook')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('port_must_be_443')
  })

  it('rejects a hostname that resolves to a private IP', async () => {
    mockDns([{ address: '10.0.0.5', family: 4 }])
    const result = await validateWebhookUrl('https://internal.example.com/hook')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('ip_denied')
  })

  it('rejects when ANY resolved record is denied (mixed public/private = fail closed)', async () => {
    mockDns([
      { address: '8.8.8.8', family: 4 },
      { address: '169.254.169.254', family: 4 },
    ])
    const result = await validateWebhookUrl('https://mixed.example.com/hook')
    expect(result.ok).toBe(false)
  })

  it('rejects an IPv4-mapped IPv6 metadata literal used directly as hostname', async () => {
    const result = await validateWebhookUrl('https://[::ffff:169.254.169.254]/hook')
    expect(result.ok).toBe(false)
  })

  it('accepts a hostname that resolves only to public IPs', async () => {
    mockDns([{ address: '8.8.8.8', family: 4 }])
    const result = await validateWebhookUrl('https://public.example.com/hook')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.hostname).toBe('public.example.com')
      expect(result.port).toBe(443)
      expect(result.resolvedIps).toEqual(['8.8.8.8'])
    }
  })

  it('accepts an explicit :443', async () => {
    mockDns([{ address: '8.8.8.8', family: 4 }])
    const result = await validateWebhookUrl('https://public.example.com:443/hook')
    expect(result.ok).toBe(true)
  })

  it('rejects when DNS resolution fails', async () => {
    lookupMock.mockRejectedValue(new Error('ENOTFOUND'))
    const result = await validateWebhookUrl('https://doesnotexist.invalid/hook')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('dns_resolution_failed')
  })
})
