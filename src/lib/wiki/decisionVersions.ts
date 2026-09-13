/**
 * Wiki の版のうち「確定した時点の控え」を扱う。
 *
 * ユーザーの言う「凍結」はページを編集できなくすることではなく、
 *   - 確定した瞬間の本文が控えとして残る
 *   - あとから本文が変わったら分かる
 * の2つ。ページ全体を閉じると、長い資料は一部しか確定しないので仕事が止まる。
 *
 * 控えは `rpc_set_spec_state` が作る。決定行を書き足す**前**の本文を、
 * `kind`（decided / implemented）と `task_id` の名札付きで `wiki_page_versions` に入れる。
 */

import type { WikiVersionKind } from '@/types/database'

/**
 * 判定に要るぶんだけ。版の一覧は本文(body)を持たない軽い形で取るので、
 * 完全な行(WikiPageVersion)には縛らない。
 */
export interface DecisionVersionLike {
  created_at: string
  kind?: WikiVersionKind | null
  task_id?: string | null
}

/** 確定の控えのうち、いちばん新しいもの。無ければ null。 */
export function latestDecisionVersion<T extends DecisionVersionLike>(
  versions: readonly T[]
): T | null {
  let latest: T | null = null
  for (const version of versions) {
    if (!version.kind || version.kind === 'autosave') continue
    if (latest === null || version.created_at > latest.created_at) {
      latest = version
    }
  }
  return latest
}

/**
 * 確定したあとに本文が変わったか。
 *
 * `rpc_set_spec_state` は同じトランザクションで控えを作りページを更新するので、
 * どちらの時刻も `now()`（トランザクションの開始時刻）で一致する。だから確定した直後は
 * false になり、そのあと誰かが保存して初めて true になる。
 *
 * 時刻が読めないときは false を返す。判断できないのに「変わっています」と出すと、
 * 確定していないものまで疑わせてしまう。
 */
export function hasChangedSinceDecision(
  latestSavedAt: string | null | undefined,
  decided: DecisionVersionLike | null
): boolean {
  if (!decided || !latestSavedAt) return false
  const updated = Date.parse(latestSavedAt)
  const decidedAt = Date.parse(decided.created_at)
  if (Number.isNaN(updated) || Number.isNaN(decidedAt)) return false
  return updated > decidedAt
}

/** 版の一覧に出す名札。自動保存の控えには出さない（数が多く、印の意味が薄れる）。 */
export function versionKindLabel(kind: WikiVersionKind | undefined | null): string | null {
  if (kind === 'decided') return '確定時点'
  if (kind === 'implemented') return '実装時点'
  return null
}
