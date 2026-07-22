import { getIntegration } from '@/lib/integrations/registry'
import type { DueReminderKind } from './dueReminderPlanner'

/**
 * Staleness ガード（設計正本 §6・クラックスC「不確かなら送らない」）。
 * DBアクセスは持たない純関数。呼び出し側（dueReminderStore.ts で再読取りしたスナップショット）を渡す。
 */

/** integration_connections から読む鮮度証明の最小形。 */
export interface DueAuthorityConnectionInfo {
  /** integration_connections.status */
  status: string
  /** integration_connections.provider（registry.ts の capabilities 逆引きに使う） */
  provider: string
  /** integration_connections.last_import_success_at（全ページ取得成功後にのみ前進する列） */
  lastImportSuccessAt: string | null
  /**
   * integration_connections.import_missing_containers（欠落台帳・コンテナID -> 欠落判明時点の
   * カーソル値）。欠落コンテナ以外の同一接続が取り切れると last_import_success_at は前進するが、
   * それは「欠落コンテナ由来のタスクの期限も鮮度証明済み」を意味しない（台帳はコンテナ単位、
   * 接続時刻は接続単位でしか無いギャップ）。未指定/取得なしは空扱い（＝コンテナ単位の抑止をしない）。
   */
  importMissingContainers?: Record<string, string> | null
}

/**
 * 権威接続が「鮮度証明を満たすか」を判定する（§6 条件3）。
 *   - 接続が見つからない（削除済み等）→ 証明できない → false
 *   - status<>'active' → false
 *   - last_import_success_at が無い → 一度も全ページ成功していない → false
 *   - タスクの所属コンテナ(externalListId)が接続の欠落台帳に載っている → false
 *     （台帳はコンテナ単位。接続全体の last_import_success_at が前進していても、
 *     欠落中のコンテナ由来タスクの期限は同期できていない可能性があるため、催促しない）
 *   - registry の capabilities から poll SLA(分)を引けない（poll-sla以外の方式）→ false（fail-quiet）
 *   - 上記を満たし、かつ経過時間が SLA 以内 → true
 */
export function isConnectionFresh(
  info: DueAuthorityConnectionInfo | null,
  now: Date,
  externalListId?: string | null,
): boolean {
  if (!info) return false
  if (info.status !== 'active') return false
  if (!info.lastImportSuccessAt) return false

  if (
    externalListId &&
    info.importMissingContainers &&
    Object.prototype.hasOwnProperty.call(info.importMissingContainers, externalListId)
  ) {
    return false
  }

  const slaMinutes = getIntegration(info.provider)?.capabilities?.pollFreshnessSlaMinutes
  if (typeof slaMinutes !== 'number') return false

  const lastSuccessMs = new Date(info.lastImportSuccessAt).getTime()
  if (Number.isNaN(lastSuccessMs)) return false

  const ageMs = now.getTime() - lastSuccessMs
  return ageMs <= slaMinutes * 60_000
}

/** 送信直前の再読取りタスクスナップショット（§6 の3条件判定に必要な最小形）。 */
export interface DueStalenessTaskSnapshot {
  status: string
  dueDate: string | null
  dueAuthorityConnectionId: string | null
  /**
   * connector_task_links.external_list_id（このタスクの所属コンテナID）。task-sync エンジン経由の
   * 取り込みでのみ埋まる。リンクが無い/他経路（gtasks・multica等）由来のタスクは undefined/null の
   * ままでよく、その場合は従来どおり接続単位の判定にフォールバックする（台帳との突き合わせをしない）。
   */
  externalListId?: string | null
}

export type DueStalenessResult = { ok: true } | { ok: false; reason: string }

/**
 * §6 の3条件AND。1つでも欠けたら suppressed 終端にする理由付きで false を返す。
 *   1. status<>'done'
 *   2. 再読取りの due_date が occurrence の due_snapshot と一致
 *   3. external権威なら接続 active かつ SLA以内、かつタスクの所属コンテナが欠落台帳に無い
 *      （isConnectionFresh）
 */
export function checkDueReminderStaleness(
  task: DueStalenessTaskSnapshot,
  dueSnapshot: string,
  connectionInfo: DueAuthorityConnectionInfo | null,
  now: Date,
): DueStalenessResult {
  if (task.status === 'done') return { ok: false, reason: 'done' }
  if (task.dueDate !== dueSnapshot) return { ok: false, reason: 'due_changed' }
  if (task.dueAuthorityConnectionId && !isConnectionFresh(connectionInfo, now, task.externalListId)) {
    return { ok: false, reason: 'stale_external_due' }
  }
  return { ok: true }
}

function diffCalendarDays(fromDateStr: string, toDateStr: string): number {
  const [fy, fm, fd] = fromDateStr.split('-').map(Number)
  const [ty, tm, td] = toDateStr.split('-').map(Number)
  const fromMs = Date.UTC(fy, fm - 1, fd)
  const toMs = Date.UTC(ty, tm - 1, td)
  return Math.round((toMs - fromMs) / 86_400_000)
}

/**
 * channel-digest の期限セクション（occurrence非依存）向けの分類。offsetToKind と同じ kind語彙を
 * 再利用することで buildDueReminderText をそのまま流用できる。翌日より先（delta>1）は対象外
 * （plannerの既定オフセットと同じ「直近のみ」の粒度に揃える）。
 */
export function classifyDueForDigest(dueDate: string, todayJst: string): DueReminderKind | null {
  const delta = diffCalendarDays(todayJst, dueDate)
  if (delta > 1) return null
  if (delta === 1) return 'due_soon'
  if (delta === 0) return 'due_today'
  return 'overdue_confirm'
}
