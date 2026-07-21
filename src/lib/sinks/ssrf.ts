import dns from 'node:dns/promises'
import { Agent, fetch as undiciFetch } from 'undici'
import ipaddr from 'ipaddr.js'

/**
 * SSRF共有バリデータ（AI_SECRETARY_STAGE3_INTEGRATIONS.md §2-3）。
 * 登録時(POST/PATCH)・test配達・本配送の3経路すべてがこのモジュールを通ること。
 *
 * 許可: https のみ・ポート443のみ・リダイレクトは追わない。
 * 拒否: ipaddr.js の range() が 'unicast' 以外の全て（loopback/private/linkLocal/
 * uniqueLocal(IPv6 ULA)/multicast/reserved/carrierGradeNat/broadcast/unspecified 等）。
 * IPv4-mapped IPv6（::ffff:0:0/96）は ipaddr.process() が自動でIPv4として正規化するため、
 * 内包IPv4が透過的に同じ判定を受ける（AWSメタデータ 169.254.169.254 も同様に拾える）。
 */

const ALLOWED_PORT = 443
const DEFAULT_TIMEOUT_MS = 10_000
/**
 * 応答本文の既定の読み取り上限(byte)。webhook配送・multica連携（`src/lib/connectors/multica/client.ts`）
 * は last_error 用の短い確認レスポンスしか読まない前提でこの値に依存しているため、
 * `maxBodyBytes` 省略時はこの値を変えない（既存呼び出し側の挙動を壊さないため）。
 */
const DEFAULT_MAX_BODY_BYTES = 500

export function isDeniedIp(ip: string): boolean {
  let addr: ReturnType<typeof ipaddr.process>
  try {
    addr = ipaddr.process(ip)
  } catch {
    // 不正な形式のIPは安全側に倒して拒否する
    return true
  }
  return addr.range() !== 'unicast'
}

export interface SsrfValidationOk {
  ok: true
  hostname: string
  port: number
  resolvedIps: string[]
}
export interface SsrfValidationFail {
  ok: false
  reason:
    | 'invalid_url'
    | 'https_required'
    | 'port_must_be_443'
    | 'ip_denied'
    | 'dns_resolution_failed'
}
export type SsrfValidationResult = SsrfValidationOk | SsrfValidationFail

export async function validateWebhookUrl(rawUrl: string): Promise<SsrfValidationResult> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return { ok: false, reason: 'invalid_url' }
  }

  if (url.protocol !== 'https:') {
    return { ok: false, reason: 'https_required' }
  }

  const port = url.port ? Number(url.port) : ALLOWED_PORT
  if (port !== ALLOWED_PORT) {
    return { ok: false, reason: 'port_must_be_443' }
  }

  // hostname は URL の bracket 表記([::1]等)を剥がした素の値
  const hostname = url.hostname

  if (ipaddr.isValid(hostname)) {
    if (isDeniedIp(hostname)) return { ok: false, reason: 'ip_denied' }
    return { ok: true, hostname, port, resolvedIps: [hostname] }
  }

  let records: Array<{ address: string; family: number }>
  try {
    records = await dns.lookup(hostname, { all: true, verbatim: true })
  } catch {
    return { ok: false, reason: 'dns_resolution_failed' }
  }
  if (!records || records.length === 0) {
    return { ok: false, reason: 'dns_resolution_failed' }
  }

  // 全レコードをdeny判定。1件でも拒否対象ならURL全体を拒否する（fail closed。
  // 公開IPと内部IPが混在するDNS応答による回避を防ぐ）。
  for (const record of records) {
    if (isDeniedIp(record.address)) {
      return { ok: false, reason: 'ip_denied' }
    }
  }

  return { ok: true, hostname, port, resolvedIps: records.map((r) => r.address) }
}

export interface SafeFetchOptions {
  method?: string
  headers?: Record<string, string>
  body?: string
  timeoutMs?: number
  /**
   * 応答本文の読み取り上限(byte)。省略時は {@link DEFAULT_MAX_BODY_BYTES}（=500。既存の
   * webhook配送・multica連携の挙動を変えない）。まとまったJSON一覧等を読む呼び出し側
   * （例: task-sync/providers/redmine.ts）は明示的に大きな値を指定すること。
   */
  maxBodyBytes?: number
}

export interface SafeFetchResult {
  ok: boolean
  status?: number
  bodyText?: string
  error?: string
  /**
   * 応答ヘッダー（小文字キー）。既存の呼び出し側（webhook配送・multica）は見ないので挙動は変わらない。
   * レート制限の復帰時刻（`Retry-After` / `X-RateLimit-Reset`）を読む必要がある呼び出し側
   * （例: task-sync/providers/redmine.ts）のために返す。これが無いと 429 を「ただの一時失敗」に
   * 潰すしかなく、制限中に固定バックオフで叩き続けて制限を自分で延長してしまう。
   */
  responseHeaders?: Record<string, string>
}

/**
 * SSRF検証込みのfetch。DNSピン留め（undici Agentのcustom lookup）で
 * 「登録時public→配送時private」のDNS rebindingを防ぐ:
 * 検証で確定したIPだけに接続を固定し、fetch実行時に再度DNS解決しない。
 */
export async function safeFetch(rawUrl: string, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const validation = await validateWebhookUrl(rawUrl)
  if (!validation.ok) {
    return { ok: false, error: `ssrf_blocked:${validation.reason}` }
  }

  const pinnedIp = validation.resolvedIps[0]
  const family = ipaddr.process(pinnedIp).kind() === 'ipv6' ? 6 : 4

  const dispatcher = new Agent({
    connect: {
      lookup: (_hostname, lookupOptions, callback) => {
        if ((lookupOptions as { all?: boolean } | undefined)?.all) {
          callback(null, [{ address: pinnedIp, family }])
        } else {
          callback(null, pinnedIp, family)
        }
      },
    },
  })

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS)

  try {
    const response = await undiciFetch(rawUrl, {
      method: options.method ?? 'POST',
      headers: options.headers,
      body: options.body,
      // 3xxは追わない（恒久失敗として呼び出し側に判定させる）
      redirect: 'manual',
      dispatcher,
      signal: controller.signal,
    })
    // レスポンスbodyは保存しない方針（last_errorへは先頭数百byteのみ切り詰めて渡す）。
    // maxBodyBytes を指定した呼び出し側（bulk JSON一覧取得等）だけ、その上限まで読める。
    const bodyText = await response.text().catch(() => '')
    // ヘッダーの取り出しは best-effort。ここで例外を投げると本文が取れていても配送全体が
    // 失敗扱いになる（ヘッダーは補助情報であり、無くても配送の成否は判定できる）。
    const responseHeaders: Record<string, string> = {}
    try {
      response.headers?.forEach((value: string, key: string) => {
        responseHeaders[key.toLowerCase()] = value
      })
    } catch {
      // 取れなくても続行する
    }
    return {
      ok: true,
      status: response.status,
      bodyText: bodyText.slice(0, options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES),
      responseHeaders,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: message }
  } finally {
    clearTimeout(timeout)
    await dispatcher.close().catch(() => {})
  }
}
