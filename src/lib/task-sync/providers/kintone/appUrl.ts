import { assertAllowedHost } from '@/lib/task-sync/hostPolicy'
import { KINTONE_HOST_POLICY } from '@/lib/task-sync/providers/kintone/client'

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

export function parseKintoneAppUrl(input: string): ParseKintoneAppUrlResult {
  const trimmed = input.trim()
  if (trimmed.length === 0) {
    return { ok: false, reason: 'URLまたはアプリIDを入力してください' }
  }

  if (isBareAppId(trimmed)) {
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

  const suffixMatch = /\.(cybozu\.com|kintone\.com)$/i.exec(url.hostname)
  const subdomain = suffixMatch ? url.hostname.slice(0, -suffixMatch[0].length) : null
  if (!subdomain) {
    return { ok: false, reason: 'URLからサブドメインを特定できません' }
  }

  return { ok: true, data: { subdomain, appId: match[1] } }
}
