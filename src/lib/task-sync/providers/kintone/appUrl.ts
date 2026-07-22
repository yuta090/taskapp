import { assertAllowedHost } from '@/lib/task-sync/hostPolicy'
import { KINTONE_HOST_POLICY } from '@/lib/task-sync/providers/kintone/client'
import { isValidKintoneAppId } from '@/lib/task-sync/providers/kintone/mapping'

/**
 * kintone アプリURLの解析（純関数） — 接続ウィザードで「アプリIDの数値を探させず、開いている
 * アプリのURLをそのまま貼ってもらう」ためのUI部品の下敷き。UI自体は本PRのスコープ外だが、
 * 純関数として先に置いておく（テスト可能性を優先し、fetch等の副作用を一切持たない）。
 *
 * 受理する形:
 *   - `https://<sub>.cybozu.com/k/123/`（アプリのトップ）
 *   - `https://<sub>.cybozu.com/k/123/show#record=5`（レコード詳細。#以降は無視する）
 *   - `https://<sub>.kintone.com/k/123/...`（ドメイン許可制プランの別ドメイン）
 *   - 数値だけの入力（例: `123`）はアプリIDそのものとして受理する(subdomainはnull＝不明のまま)。
 *
 * ゲストスペース配下のアプリURL（`/k/guest/{spaceId}/{appId}/...`）は今回のスコープ外
 * （必要になれば別途対応する。誤って一般形式にマッチさせないよう、ここでは明示的に弾く）。
 */

export interface KintoneAppUrlData {
  /** URLから取れたサブドメイン。数値のみの入力を受理した場合は null（不明）。 */
  subdomain: string | null
  appId: string
}

export type ParseKintoneAppUrlResult =
  | { ok: true; data: KintoneAppUrlData }
  | { ok: false; reason: string }

/** 数値のみ（先頭ゼロを含む純粋な数字列）かどうか。 */
function isBareAppId(input: string): boolean {
  return /^\d+$/.test(input)
}

/** URLのhostnameからkintoneのサブドメイン部分を取り出す(サフィックス無ければnull)。 */
function subdomainFromHostname(hostname: string): string | null {
  const suffixMatch = /\.(cybozu\.com|kintone\.com)$/i.exec(hostname)
  return suffixMatch ? hostname.slice(0, -suffixMatch[0].length) : null
}

export function parseKintoneAppUrl(input: string): ParseKintoneAppUrlResult {
  const trimmed = input.trim()
  if (trimmed.length === 0) {
    return { ok: false, reason: 'URLまたはアプリIDを入力してください' }
  }

  if (isBareAppId(trimmed)) {
    // 数字だけの入力は桁数の上限が無いと、巨大な文字列がそのままアプリIDとして保存され得る
    // （mapping.ts の isValidKintoneAppId と同じ上限＝20桁。kintoneのappIdは実務上10桁未満）。
    if (!isValidKintoneAppId(trimmed)) {
      return { ok: false, reason: 'アプリIDの桁数が多すぎます(20桁以内で指定してください)' }
    }
    return { ok: true, data: { subdomain: null, appId: trimmed } }
  }

  let url: URL
  try {
    // ホスト境界の検証（vendor-domain・ドット境界一致。https限定・認証情報禁止・標準ポート限定も
    // ここで一緒に検証される）はアダプタの hostPolicy と完全に同じ関数を使う。ここを緩めると
    // 「別サービスのURLを貼っても通る」入口ができてしまう。
    url = assertAllowedHost(KINTONE_HOST_POLICY, trimmed, 'kintone')
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : 'kintoneの正規ドメインのURLではありません' }
  }

  // ゲストスペース配下は明示的に非対応（"/k/guest/.../..."）。一般形式と誤ってマッチしないよう先に弾く。
  if (/^\/k\/guest\//i.test(url.pathname)) {
    return { ok: false, reason: 'ゲストスペース配下のアプリURLには対応していません' }
  }

  const match = /^\/k\/(\d+)(?:\/|$)/.exec(url.pathname)
  if (!match) {
    return { ok: false, reason: 'URLからアプリIDを特定できません(/k/<数字>/ の形式ではありません)' }
  }

  const subdomain = subdomainFromHostname(url.hostname)
  if (!subdomain) {
    return { ok: false, reason: 'URLからサブドメインを特定できません' }
  }

  return { ok: true, data: { subdomain, appId: match[1] } }
}

export type ParseKintoneSubdomainResult =
  | { ok: true; baseUrl: string; subdomain: string }
  | { ok: false; reason: string }

/**
 * 裸のサブドメイン(英数字とハイフンのみ。kintoneのサブドメイン規則に合わせる)かどうか。
 *
 * サブドメインは実質DNSラベル1つ分であり、DNSラベルの実際の制約(RFC 1035: 先頭・末尾は
 * 英数字のみ・ハイフンは中間にのみ許可・最大63文字)に合わせる。この検証が無いと、
 * 「-foo」のような先頭ハイフンや、異常に長い文字列がそのまま baseUrl に組み込まれて保存され得る
 * （組み立てた URL 自体は assertAllowedHost が受理してしまい、ここでしか弾けない）。
 */
const BARE_SUBDOMAIN_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/

/**
 * 接続フォームの「サブドメイン」欄の解析（純関数）— parseKintoneAppUrl と違い `/k/<数字>/`
 * パスを要求しない(サブドメインの入力だけで完結する欄のため)。
 *
 * 受理する形:
 *   - 裸のサブドメイン(例: `my-company`) → `https://my-company.cybozu.com` を組み立てる
 *   - サブドメインを含む任意のURL(パス有無を問わない。例: `https://foo.cybozu.com/k/123/` を
 *     誤って貼っても、パスを無視してサブドメインだけ取り出す＝利用者に優しい)
 *
 * ホスト境界の検証(vendor-domain・ドット境界一致・https限定・認証情報禁止・標準ポート限定)は
 * parseKintoneAppUrl と同じ assertAllowedHost に委譲する(境界判定を2箇所に分岐させない)。
 */
export function parseKintoneSubdomainInput(input: string): ParseKintoneSubdomainResult {
  const trimmed = input.trim()
  if (trimmed.length === 0) {
    return { ok: false, reason: 'サブドメインを入力してください' }
  }

  if (BARE_SUBDOMAIN_RE.test(trimmed)) {
    return { ok: true, baseUrl: `https://${trimmed}.cybozu.com`, subdomain: trimmed }
  }

  let url: URL
  try {
    url = assertAllowedHost(KINTONE_HOST_POLICY, trimmed, 'kintone')
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : 'kintoneの正規ドメインのURLではありません' }
  }

  const subdomain = subdomainFromHostname(url.hostname)
  if (!subdomain) {
    return { ok: false, reason: 'URLからサブドメインを特定できません' }
  }

  return { ok: true, baseUrl: url.origin, subdomain }
}
