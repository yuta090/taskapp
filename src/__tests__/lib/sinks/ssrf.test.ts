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

// m4: undici側をモックし、safeFetchが実際に渡すAgentのconnect.lookupを検証できるようにする
const agentConstructorMock = vi.fn()
const agentCloseMock = vi.fn(() => Promise.resolve())
class MockAgent {
  options: Record<string, unknown>
  constructor(options: Record<string, unknown>) {
    this.options = options
    agentConstructorMock(options)
  }
  close() {
    return agentCloseMock()
  }
}
const undiciFetchMock = vi.fn()
vi.mock('undici', () => ({
  Agent: MockAgent,
  fetch: (...args: unknown[]) => undiciFetchMock(...args),
}))

const { validateWebhookUrl, isDeniedIp, safeFetch } = await import('@/lib/sinks/ssrf')

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

describe('safeFetch (DNS pinning)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    undiciFetchMock.mockResolvedValue({ status: 200, headers: new Headers(), text: () => Promise.resolve('') })
  })

  // m4: DNS rebinding対策の核。validateWebhookUrlで確定したIPだけに接続を固定し、
  // 実際の接続時(connect.lookup)には再度DNS解決しない(=登録時public→配送時private
  // への差し替えが効かない)ことを保証する回帰テスト。
  it('pins the connection to the IP resolved during validation and does not re-resolve DNS at connect time', async () => {
    mockDns([{ address: '8.8.8.8', family: 4 }])

    await safeFetch('https://public.example.com/hook', { method: 'POST', body: '{}' })

    // 検証フェーズでdns.lookupが呼ばれるのは1回だけ(safeFetch内で再解決しない)
    expect(lookupMock).toHaveBeenCalledTimes(1)

    expect(agentConstructorMock).toHaveBeenCalledTimes(1)
    const agentOptions = agentConstructorMock.mock.calls[0][0] as {
      connect: { lookup: (...args: unknown[]) => void }
    }
    const customLookup = agentOptions.connect.lookup
    expect(typeof customLookup).toBe('function')

    // undici/nodeの内部コネクタが実際の接続時にこの関数を呼んでも、
    // 渡されたhostnameに関わらず検証済みIPだけを返す(=DNSを再度引かない)
    const callback = vi.fn()
    customLookup('attacker-controlled-hostname.example', { all: true }, callback)
    expect(callback).toHaveBeenCalledWith(null, [{ address: '8.8.8.8', family: 4 }])

    // customLookup呼び出し後もdns.lookupの呼び出し回数は増えない(接続時の再解決が無い証拠)
    expect(lookupMock).toHaveBeenCalledTimes(1)
  })

  it('pins an IPv6 resolved address with family=6', async () => {
    mockDns([{ address: '2001:4860:4860::8888', family: 6 }])

    await safeFetch('https://public.example.com/hook')

    const agentOptions = agentConstructorMock.mock.calls[0][0] as {
      connect: { lookup: (...args: unknown[]) => void }
    }
    const callback = vi.fn()
    agentOptions.connect.lookup('public.example.com', { all: true }, callback)
    expect(callback).toHaveBeenCalledWith(null, [{ address: '2001:4860:4860::8888', family: 6 }])
  })

  it('never calls the real undici fetch when SSRF validation fails', async () => {
    mockDns([{ address: '169.254.169.254', family: 4 }])
    const result = await safeFetch('https://metadata.example.com/hook')
    expect(result.ok).toBe(false)
    expect(result.error).toBe('ssrf_blocked:ip_denied')
    expect(undiciFetchMock).not.toHaveBeenCalled()
    expect(agentConstructorMock).not.toHaveBeenCalled()
  })

  // m5: maxBodyBytes（bulk一覧取得の呼び出し向け。task-sync/providers/redmine.ts が使う）。
  // 既存呼び出し側（webhook配送・multica連携）は小さな確認レスポンスしか読まない前提で
  // 500byte打ち切りに依存しているため、オプション省略時の挙動を変えてはならない。
  it('caps bodyText at 500 bytes by default when maxBodyBytes is omitted (既存呼び出し側の挙動を変えない)', async () => {
    mockDns([{ address: '8.8.8.8', family: 4 }])
    const big = 'x'.repeat(1000)
    undiciFetchMock.mockResolvedValueOnce({ status: 200, headers: new Headers(), text: () => Promise.resolve(big) })
    const result = await safeFetch('https://public.example.com/hook')
    expect(result.ok).toBe(true)
    expect(result.bodyText).toHaveLength(500)
  })

  it('honors maxBodyBytes to allow larger bounded reads (bulk JSON一覧取得向け)', async () => {
    mockDns([{ address: '8.8.8.8', family: 4 }])
    const big = 'x'.repeat(1000)
    undiciFetchMock.mockResolvedValueOnce({ status: 200, headers: new Headers(), text: () => Promise.resolve(big) })
    const result = await safeFetch('https://public.example.com/hook', { maxBodyBytes: 2000 })
    expect(result.ok).toBe(true)
    expect(result.bodyText).toHaveLength(1000) // 全文(1000byte)が2000byteの上限内に収まる
  })

  it('still truncates when the response exceeds an explicitly larger maxBodyBytes', async () => {
    mockDns([{ address: '8.8.8.8', family: 4 }])
    const big = 'x'.repeat(3000)
    undiciFetchMock.mockResolvedValueOnce({ status: 200, headers: new Headers(), text: () => Promise.resolve(big) })
    const result = await safeFetch('https://public.example.com/hook', { maxBodyBytes: 2000 })
    expect(result.ok).toBe(true)
    expect(result.bodyText).toHaveLength(2000)
  })

  // m5: safeFetch は応答ヘッダーも返す（429/503 の Retry-After を呼び出し側(redmine.ts)が
  // 読むため。ヘッダーを捨てると制限中に叩き続けて制限期間を自分で延ばしてしまう）。
  it('returns response headers (lowercased keys) via responseHeaders', async () => {
    mockDns([{ address: '8.8.8.8', family: 4 }])
    undiciFetchMock.mockResolvedValueOnce({
      status: 429,
      headers: new Headers({ 'Retry-After': '30' }),
      text: () => Promise.resolve(''),
    })
    const result = await safeFetch('https://public.example.com/hook')
    expect(result.ok).toBe(true)
    expect(result.responseHeaders?.['retry-after']).toBe('30')
  })
})
