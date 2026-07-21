import { asanaAdapter } from '@/lib/task-sync/providers/asana'
import { backlogAdapter } from '@/lib/task-sync/providers/backlog'
import { jiraAdapter } from '@/lib/task-sync/providers/jira'
import { jootoAdapter } from '@/lib/task-sync/providers/jooto'
import { linearAdapter } from '@/lib/task-sync/providers/linear'
import { notionAdapter } from '@/lib/task-sync/providers/notion'
import { redmineAdapter } from '@/lib/task-sync/providers/redmine'
import { trelloAdapter } from '@/lib/task-sync/providers/trello'
import type { TaskSyncAdapter, TaskSyncProviderId } from '@/lib/task-sync/types'

/**
 * アダプタ登録表 — 「この provider にはどのアダプタが対応するか」の唯一の真実の源（TS側）。
 *
 * DB の provider 列は形式チェック（`^[a-z][a-z0-9_]{1,63}$`）のみで、値の妥当性はここが持つ。
 * 列挙 CHECK をDBに置くとツール追加のたびに migration が要り、対応ツールが数十規模になる前提と
 * 釣り合わないため、真実源をTS側に一本化した（registry.ts のカタログと対で運用する）。
 *
 * ⚠ その代わり、**接続を作る経路は必ずこの表で provider を検証すること**。
 *   未知の provider が入った接続は取り込みワーカーが skip するだけで、作成自体は止められない。
 *
 * 新しいツールを足す = アダプタを1本書いて、ここに1行足す。
 */
export const TASK_SYNC_ADAPTERS: Partial<Record<TaskSyncProviderId, TaskSyncAdapter>> = {
  backlog: backlogAdapter,
  jooto: jootoAdapter,
  jira: jiraAdapter,
  redmine: redmineAdapter,
  asana: asanaAdapter,
  trello: trelloAdapter,
  linear: linearAdapter,
  notion: notionAdapter,
}

/** provider 文字列に対応するアダプタを引く。未対応なら null（呼び出し側が skip する）。 */
export function getTaskSyncAdapter(provider: string): TaskSyncAdapter | null {
  return TASK_SYNC_ADAPTERS[provider as TaskSyncProviderId] ?? null
}

// 実装済み provider の ID 一覧は client 安全な implemented.ts に置く（adapters.ts を client が
// import すると redmine → ssrf.ts の node:dns/promises が client バンドルに混入して Turbopack
// build が落ちるため）。ここでは server 側の既存 import 元を保つため re-export だけする。
// TASK_SYNC_ADAPTERS のキーと IMPLEMENTED_TASK_SYNC_PROVIDERS の parity は
// implemented.test.ts が保証する。
export { implementedTaskSyncProviders } from '@/lib/task-sync/implemented'
