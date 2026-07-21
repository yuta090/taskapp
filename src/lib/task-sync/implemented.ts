import type { TaskSyncProviderId } from '@/lib/task-sync/types'

/**
 * 実装済み（実際に接続できる）task-sync provider の ID 一覧 — **client 安全な単独モジュール**。
 *
 * ⚠ なぜ adapters.ts から分離するか（Vercel/Turbopack build 対策）:
 *   adapters.ts は各アダプタ実装を値 import し、その一部（redmine → safeFetch →
 *   src/lib/sinks/ssrf.ts）が `node:dns/promises` を引く **server 専用**。client コンポーネント
 *   （IntegrationsConsoleClient）が「実装済みID一覧」を得るためだけに adapters.ts を import
 *   すると、この Node 専用依存が client バンドルへ混入し Turbopack build が落ちる
 *   （`the chunking context does not support external modules (request: node:dns/promises)`）。
 *   ID一覧は型情報だけで足りるため、値 import を一切持たない（`import type` のみ＝ビルド時に
 *   消える）この軽量モジュールに置き、client はここから import する。
 *
 * 単一真実源はあくまで adapters.ts の TASK_SYNC_ADAPTERS（アダプタ実体があるものが実装済み）。
 * 両者の parity は src/__tests__/lib/task-sync/implemented.test.ts が保証する
 * （どちらか片方だけに provider を足すとテストが落ちる）。新ツール追加時は
 * 「アダプタを1本書いて adapters.ts に1行」＋「この配列に1行」の2箇所を揃える。
 */
export const IMPLEMENTED_TASK_SYNC_PROVIDERS = [
  'backlog',
  'jooto',
  'jira',
  'redmine',
  'asana',
  'trello',
  'linear',
] as const satisfies readonly TaskSyncProviderId[]

/** アダプタ実装済み＝実際に接続できる provider の一覧（接続作成時の検証・UIの絞り込みに使う）。 */
export function implementedTaskSyncProviders(): TaskSyncProviderId[] {
  return [...IMPLEMENTED_TASK_SYNC_PROVIDERS]
}

/** provider が実装済みか（接続パネルの存在チェックに使う。adapters を import せずに判定する）。 */
export function isImplementedTaskSyncProvider(id: string): boolean {
  return (IMPLEMENTED_TASK_SYNC_PROVIDERS as readonly string[]).includes(id)
}

/**
 * 接続時に接続先URL（base URL）の入力が要る provider（＝アダプタの hostPolicy.kind が
 * 'fixed' 以外＝接続先が可変）の client 安全なメタ。接続パネルの入力フォーム出し分けに使う。
 *
 * 真実源は各アダプタの hostPolicy.kind（server 側）。ここはその派生を client 安全に写した値で、
 * `kind !== 'fixed'` との一致を implemented.test.ts が provider ごとに検証する（drift を落とす）。
 *   vendor-domain / any-https → true（backlog=vendor / jira=vendor / redmine=any-https）
 *   fixed                     → false（jooto / asana / trello / linear）
 */
export const TASK_SYNC_PROVIDER_NEEDS_BASE_URL: Record<
  (typeof IMPLEMENTED_TASK_SYNC_PROVIDERS)[number],
  boolean
> = {
  backlog: true,
  jooto: false,
  jira: true,
  redmine: true,
  asana: false,
  trello: false,
  linear: false,
}

/** 接続時に base URL 入力が要るか（未実装/未知IDは false）。 */
export function taskSyncProviderNeedsBaseUrl(id: string): boolean {
  return TASK_SYNC_PROVIDER_NEEDS_BASE_URL[id as keyof typeof TASK_SYNC_PROVIDER_NEEDS_BASE_URL] ?? false
}
