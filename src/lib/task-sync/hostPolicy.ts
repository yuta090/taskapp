import { providerError, type HostPolicy } from '@/lib/task-sync/types'

/**
 * 接続先ホストの検証（SSRF境界）。全アダプタで共通の判定をここに1本化する。
 *
 * なぜアダプタ側でも毎回検証するのか（接続作成時の検証だけでは不十分な理由）:
 *   - DNS は接続作成後に別のIPへ向け直せる（rebinding）。
 *   - 過去の実装や別経路で保存された行が残り得る。
 *   - 実際にリクエストを出す層が最後の砦であり、そこを通らない防御は迂回され得る。
 *
 * 特に APIキーをクエリで送るツール（Backlog / Trello）では、**送信先を間違えること自体が
 * 鍵の漏洩**になる。ここは「入力バリデーション」ではなくセキュリティ境界として扱う。
 */

/** ドット境界で許可サフィックスに一致するか。`evil-backlog.jp` や `backlog.jp.evil.com` を弾く。 */
function matchesVendorSuffix(hostname: string, allowedSuffixes: readonly string[]): boolean {
  const host = hostname.toLowerCase()
  return allowedSuffixes.some((rawSuffix) => {
    const suffix = rawSuffix.toLowerCase()
    // サフィックスは先頭ドット必須（'.backlog.jp'）。テナント名が必ず前に付くため、
    // ホスト名はサフィックスより長くなければならない（'.backlog.jp' 自体は接続先になり得ない）。
    return host.endsWith(suffix) && host.length > suffix.length
  })
}

/**
 * baseUrl（またはリクエストURL）が hostPolicy に適合するか検証し、正規化した URL を返す。
 * 適合しなければ permanent な ProviderError を投げる（再試行では直らない設定不備のため）。
 *
 * any-https は「許可リストで守れない」ことが前提なので、ここでは形式（https/標準ポート/認証情報なし）
 * だけを見る。実際のIP検査とDNSピン留めは safeFetch（src/lib/sinks/ssrf.ts）の責務であり、
 * any-https を宣言したアダプタは必ずそちらを経由すること。
 */
export function assertAllowedHost(policy: HostPolicy, rawUrl: string, providerLabel: string): URL {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw providerError(`${providerLabel}: 接続先URLの形式が不正です`, { permanent: true, status: 400 })
  }

  if (url.protocol !== 'https:') {
    // 平文だと資格情報がそのまま流れる。ツール側が http を許していても許可しない。
    throw providerError(`${providerLabel}: 接続先は https のみ許可します`, { permanent: true, status: 400 })
  }
  if (url.username || url.password) {
    // https://real.example.com@evil.example は evil.example に接続する。見た目で人を騙せる形。
    throw providerError(`${providerLabel}: 接続先URLに認証情報を含めることはできません`, {
      permanent: true,
      status: 400,
    })
  }
  if (url.port && url.port !== '443') {
    // 正規のクラウドサービスは443のみ。ポート指定は内部ネットワーク探索の手口でもある。
    throw providerError(`${providerLabel}: 接続先URLに非標準ポートは指定できません`, {
      permanent: true,
      status: 400,
    })
  }

  if (policy.kind === 'fixed') {
    if (url.hostname.toLowerCase() !== policy.host.toLowerCase()) {
      throw providerError(`${providerLabel}: 接続先ホストが固定値と一致しません`, {
        permanent: true,
        status: 400,
      })
    }
    return url
  }

  if (policy.kind === 'vendor-domain') {
    if (!matchesVendorSuffix(url.hostname, policy.allowedSuffixes)) {
      throw providerError(`${providerLabel}: このツールの正規ドメインではありません`, {
        permanent: true,
        status: 400,
      })
    }
    return url
  }

  // any-https: ここでは形式のみ。IP検査・DNSピン留めは safeFetch が行う（上のコメント参照）。
  return url
}

/** baseUrl 必須のポリシー（vendor-domain / any-https）で未設定なら permanent エラーにする。 */
export function requireBaseUrl(
  policy: HostPolicy,
  baseUrl: string | null | undefined,
  providerLabel: string,
): string {
  if (policy.kind === 'fixed') return `https://${policy.host}`
  if (!baseUrl) {
    // 接続作成時に必須入力のため、ここに来るのは配線ミス。資格情報を送る前に止める。
    throw providerError(`${providerLabel}: 接続先URLが設定されていない接続です`, {
      permanent: true,
      status: 400,
    })
  }
  return baseUrl
}
