import type { SinkProvider } from '@/lib/sinks/store'

/**
 * ツール連携レジストリ — 秘書が「連携できる外部ツール／データ先」の単一の真実の源。
 *
 * 「つなぐ」タブ（チャネル軸＝人・チャット, src/lib/channels/registry.ts）とは別軸で、
 * ここは “道具とデータ” 軸を1箇所に集約する。UIのカタログ（ToolRail/詳細ペイン）・
 * 課金バッジ表示・ドキュメントがすべてこの定義を参照する。
 *
 * 新しいツールを足す = ここに 1 エントリ足すだけ（レール／カタログに自動で並ぶ）。
 *
 * ⚠ 課金の真実源ではない: `proOnly` は「Pro」バッジの表示ヒントに過ぎない。実際の機能ゲート
 *   （拒否・上限）は src/lib/billing/entitlements.ts（PLAN_FEATURES / PLAN_LIMITS）が唯一の
 *   真実源。ここに課金ロジックを二重化しない（channels/registry.ts の proOnly と同じ約束）。
 */

export type IntegrationId =
  // タスク同期（双方向・プロジェクト管理/タスク管理）
  | 'google_tasks'
  | 'multica'
  | 'backlog'
  | 'jooto'
  | 'jira'
  | 'redmine'
  | 'asana'
  | 'trello'
  | 'microsoft_todo'
  | 'linear'
  | 'wrike'
  | 'clickup'
  | 'monday'
  | 'chatwork'
  | 'garoon'
  // データ書き出し・通知（送りっぱなし）
  | 'webhook'
  | 'notion'
  | 'google_sheets'
  | 'kintone'
  | 'airtable'
  | 'csv_export'
  // 会計・請求
  | 'freee'
  | 'money_forward'
  | 'misoca'

/** 表示順を保った全ツールID（レール／カタログでの並び順）。 */
export const ALL_INTEGRATION_IDS: readonly IntegrationId[] = [
  // task_sync（主要 → その他の順。UIは featured を先頭に出し残りを「すべて表示」で開く）
  'google_tasks',
  'multica',
  'backlog',
  'jooto',
  'jira',
  'redmine',
  'asana',
  'trello',
  'microsoft_todo',
  'linear',
  'wrike',
  'clickup',
  'monday',
  'chatwork',
  'garoon',
  // data_export
  'webhook',
  'notion',
  'google_sheets',
  'kintone',
  'airtable',
  'csv_export',
  // accounting
  'freee',
  'money_forward',
  'misoca',
] as const

/** カテゴリ（レールの見出し）。 */
export type IntegrationCategory = 'task_sync' | 'data_export' | 'accounting'

/** カテゴリの表示順と表示名。 */
export const CATEGORY_ORDER: readonly IntegrationCategory[] = [
  'task_sync',
  'data_export',
  'accounting',
] as const

export const CATEGORY_LABEL: Record<IntegrationCategory, string> = {
  task_sync: 'タスク同期',
  data_export: 'データ書き出し・通知',
  accounting: '会計・請求',
}

/** 連携の方向。UI表示と役割の説明に使う。 */
export type IntegrationDirection = 'two_way' | 'notify' | 'export'

export const DIRECTION_LABEL: Record<IntegrationDirection, string> = {
  two_way: '双方向同期',
  notify: '通知（送りっぱなし）',
  export: '書き出し',
}

/**
 * 実装状況（channels/registry.ts と同じ語彙）。
 *  - ga:      実装済みで本番利用可
 *  - beta:    限定利用可（要検証）
 *  - planned: カタログ掲載のみ（ロードマップ）
 */
export type IntegrationImplStatus = 'ga' | 'beta' | 'planned'

/**
 * 詳細ペインの出し分け（どの管理UIで扱うか）。
 *  - connector: 双方向同期。ConnectorSyncPane（gtasks import / multica 接続）。
 *  - sink:      通知連携（送りっぱなし）。SinkProviderPanel/SinkDetailPanel（sinkProvider で特定）。
 *  - export:    その場でのデータ書き出し（CSV等）。
 *  - catalog:   未実装（planned）。ToolConnectOverview の「近日」詳細のみ。
 */
export type IntegrationSurface = 'connector' | 'sink' | 'export' | 'catalog'

/**
 * AI秘書 Stage5 期限リマインド用の connector capabilities(docs/spec/AI_SECRETARY_STAGE5_DUE_REMINDERS.md
 * §4.5/§5.3/§6)。connector surface(gtasks/multica)のみが持つ。値の追加は connector を増やすときのみ。
 *  - dueImport:    この接続が due_date を取り込む(=正本になり得る)か。
 *  - completionWrite: 完了をこの接続へ書き戻す(complete)か。
 *  - dueFreshness: 鮮度証明の方式。'poll-sla'=poll間隔ベースの有界遅延で証明／'webhook-observed'=
 *                  webhookのobserved_atで証明(将来)／'none'=証明対象の due が無い(=リマインド対象外)。
 *  - pollFreshnessSlaMinutes: 'poll-sla' のときの許容遅延(分)。実 cron 間隔×2が目安(§6)。
 */
export interface IntegrationCapabilities {
  dueImport: boolean
  completionWrite: boolean
  dueFreshness: 'poll-sla' | 'webhook-observed' | 'none'
  pollFreshnessSlaMinutes?: number
}

/**
 * gtasks import の pg_cron 間隔("15分ごと"。supabase/migrations/20260720180744_connector_cron.sql の
 * 'connector-import' ジョブ)。鮮度SLAはこの間隔×2を許容遅延とする(§6 の根拠と同じ)。
 */
const GTASKS_IMPORT_POLL_INTERVAL_MINUTES = 15

export interface IntegrationDefinition {
  id: IntegrationId
  /** UI表示名 */
  label: string
  category: IntegrationCategory
  direction: IntegrationDirection
  status: IntegrationImplStatus
  surface: IntegrationSurface
  /** surface='sink' のとき対応する integration_sinks のプロバイダ */
  sinkProvider?: SinkProvider
  /** surface='connector' のとき対応する双方向コネクタ種別 */
  connectorKind?: 'google_tasks' | 'multica'
  /**
   * 「Pro」バッジの表示ヒント（課金の真実源ではない・冒頭の注意参照）。
   * CLAUDE.md 方針: 外部連携（双方向のタスク同期・会計連携）は原則 Pro 専有。
   */
  proOnly?: boolean
  /**
   * 主要ツール。UI（ToolRail / カタログ）は featured だけを初期表示し、残りは「すべて表示」で開く。
   * 対応ツールが数十規模になっても最初の画面が壊れないようにするための表示制御であり、
   * 実装状況（status）とは独立（planned でもロードマップの目玉なら featured にしてよい）。
   * ただし GA/BETA（実際に使えるもの）は必ず featured にする＝使えるものを畳んで隠さない。
   */
  featured?: boolean
  /** 開発者コンソール等の外部URL（doc/詳細用） */
  setupUrl?: string
  /** doc/UIの補足 */
  notes?: string
  /**
   * AI秘書 Stage5 期限リマインドの connector surface capabilities。connector(gtasks/multica)のみ持つ。
   * 課金の真実源ではない proOnly と同様、こちらも「送信可否」の真実源ではなく connector の能力宣言のみ
   * （実際の gating は entitlements.ts・鮮度判定は §6 のsender側ロジックが参照する）。
   */
  capabilities?: IntegrationCapabilities
}

/**
 * ツール定義。並び順 = ALL_INTEGRATION_IDS（UI/ドキュメントの表示順）。
 */
export const INTEGRATIONS: Record<IntegrationId, IntegrationDefinition> = {
  // ---- タスク同期（双方向） ---------------------------------------------
  google_tasks: {
    id: 'google_tasks',
    label: 'Google Tasks',
    category: 'task_sync',
    direction: 'two_way',
    status: 'ga',
    surface: 'connector',
    connectorKind: 'google_tasks',
    proOnly: true,
    featured: true,
    setupUrl: 'https://developers.google.com/tasks',
    notes:
      '既存のタスク管理を使う企業はそのツール(Google Tasks)が正本、TaskAppは中継（ハブ&スポーク）。完了も両側へ反映。',
    capabilities: {
      dueImport: true,
      completionWrite: true,
      dueFreshness: 'poll-sla',
      pollFreshnessSlaMinutes: GTASKS_IMPORT_POLL_INTERVAL_MINUTES * 2,
    },
  },
  multica: {
    id: 'multica',
    label: 'multica',
    category: 'task_sync',
    direction: 'two_way',
    status: 'ga',
    surface: 'connector',
    connectorKind: 'multica',
    proOnly: true,
    featured: true,
    notes: 'multica と相互に同期。発生元チャットへの完了返信まで配線済み（LINE-first）。',
    // due_date を持たない(rpc_connector_create_task は due を挿入しない・契約上due変更イベントも無い)。
    // §3の実コード事実: multica起票タスクはdueが無いため証明対象が存在せずdueFreshness='none'。
    capabilities: {
      dueImport: false,
      completionWrite: true,
      dueFreshness: 'none',
    },
  },
  backlog: {
    id: 'backlog',
    label: 'Backlog',
    category: 'task_sync',
    direction: 'two_way',
    status: 'planned',
    surface: 'catalog',
    proOnly: true,
    featured: true,
    setupUrl: 'https://developer.nulab.com/ja/docs/backlog/',
    notes: '日本のSMB/受託で普及するプロジェクト管理。スペースURLとAPIキーで接続する（双方向同期は順次対応）。',
  },
  jooto: {
    id: 'jooto',
    label: 'Jooto',
    category: 'task_sync',
    direction: 'two_way',
    status: 'planned',
    surface: 'catalog',
    proOnly: true,
    featured: true,
    setupUrl: 'https://www.jooto.com/',
    notes: '国産のカンバン型タスク管理。APIキーで接続する（双方向同期は順次対応）。',
  },
  jira: {
    id: 'jira',
    label: 'Jira',
    category: 'task_sync',
    direction: 'two_way',
    status: 'planned',
    surface: 'catalog',
    proOnly: true,
    featured: true,
    setupUrl: 'https://developer.atlassian.com/cloud/jira/platform/',
    notes: '課題管理の標準。取り込む課題の範囲（プロジェクト/JQL）を指定して同期する。',
  },
  redmine: {
    id: 'redmine',
    label: 'Redmine',
    category: 'task_sync',
    direction: 'two_way',
    status: 'planned',
    surface: 'catalog',
    proOnly: true,
    featured: true,
    setupUrl: 'https://www.redmine.org/projects/redmine/wiki/Rest_api',
    notes: '自社サーバー運用の定番。サーバーURLとAPIアクセスキーで接続する（自ホストのため接続先の検証を伴う）。',
  },
  asana: {
    id: 'asana',
    label: 'Asana',
    category: 'task_sync',
    direction: 'two_way',
    status: 'planned',
    surface: 'catalog',
    proOnly: true,
    featured: true,
    setupUrl: 'https://developers.asana.com/docs',
  },
  trello: {
    id: 'trello',
    label: 'Trello',
    category: 'task_sync',
    direction: 'two_way',
    status: 'planned',
    surface: 'catalog',
    proOnly: true,
    featured: true,
    setupUrl: 'https://developer.atlassian.com/cloud/trello/rest/',
  },
  microsoft_todo: {
    id: 'microsoft_todo',
    label: 'Microsoft To Do',
    category: 'task_sync',
    direction: 'two_way',
    status: 'planned',
    surface: 'catalog',
    proOnly: true,
    featured: true,
    notes: 'Microsoft 365 環境の標準タスク。Planner との使い分けは接続時に選ぶ。',
  },
  linear: {
    id: 'linear',
    label: 'Linear',
    category: 'task_sync',
    direction: 'two_way',
    status: 'planned',
    surface: 'catalog',
    proOnly: true,
    setupUrl: 'https://linear.app/developers',
  },
  wrike: {
    id: 'wrike',
    label: 'Wrike',
    category: 'task_sync',
    direction: 'two_way',
    status: 'planned',
    surface: 'catalog',
    proOnly: true,
    setupUrl: 'https://developers.wrike.com/',
  },
  clickup: {
    id: 'clickup',
    label: 'ClickUp',
    category: 'task_sync',
    direction: 'two_way',
    status: 'planned',
    surface: 'catalog',
    proOnly: true,
    setupUrl: 'https://developer.clickup.com/docs',
  },
  monday: {
    id: 'monday',
    label: 'monday.com',
    category: 'task_sync',
    direction: 'two_way',
    status: 'planned',
    surface: 'catalog',
    proOnly: true,
    setupUrl: 'https://developer.monday.com/api-reference/docs',
  },
  chatwork: {
    id: 'chatwork',
    label: 'Chatwork タスク',
    category: 'task_sync',
    direction: 'two_way',
    status: 'planned',
    surface: 'catalog',
    proOnly: true,
    setupUrl: 'https://developer.chatwork.com/docs',
    notes: 'Chatwork のタスク機能と同期する（チャット接続=「つなぐ」タブとは別軸のタスク同期）。',
  },
  garoon: {
    id: 'garoon',
    label: 'Garoon',
    category: 'task_sync',
    direction: 'two_way',
    status: 'planned',
    surface: 'catalog',
    proOnly: true,
    notes: 'サイボウズ Garoon のToDo。企業内グループウェア利用企業向け。',
  },
  // ---- データ書き出し・通知（送りっぱなし） -----------------------------
  webhook: {
    id: 'webhook',
    label: 'Webhook',
    category: 'data_export',
    direction: 'notify',
    status: 'ga',
    surface: 'sink',
    sinkProvider: 'webhook',
    featured: true,
    notes: 'タスクの発生を任意のエンドポイントへ送出（署名付き）。',
  },
  notion: {
    id: 'notion',
    label: 'Notion',
    category: 'data_export',
    direction: 'notify',
    status: 'ga',
    surface: 'sink',
    sinkProvider: 'notion',
    featured: true,
    setupUrl: 'https://www.notion.so/my-integrations',
    notes: 'タスクをNotionデータベースへ送りっぱなしで書き出す。',
  },
  google_sheets: {
    id: 'google_sheets',
    label: 'Google Sheets',
    category: 'data_export',
    direction: 'notify',
    status: 'ga',
    surface: 'sink',
    sinkProvider: 'google_sheets',
    featured: true,
    notes: 'タスクの発生をスプレッドシートへ追記する。',
  },
  kintone: {
    id: 'kintone',
    label: 'kintone',
    category: 'data_export',
    direction: 'notify',
    status: 'planned',
    surface: 'catalog',
    notes: '業務アプリ基盤への書き出し。順次対応。',
  },
  airtable: {
    id: 'airtable',
    label: 'Airtable',
    category: 'data_export',
    direction: 'notify',
    status: 'planned',
    surface: 'catalog',
  },
  csv_export: {
    id: 'csv_export',
    label: 'CSVエクスポート',
    category: 'data_export',
    direction: 'export',
    status: 'ga',
    surface: 'export',
    featured: true,
    notes: 'freee・マネーフォワード等の会計ソフトへ取り込むためのCSVを書き出す。',
  },
  // ---- 会計・請求 -------------------------------------------------------
  freee: {
    id: 'freee',
    label: 'freee',
    category: 'accounting',
    direction: 'two_way',
    status: 'planned',
    surface: 'catalog',
    proOnly: true,
    featured: true,
    setupUrl: 'https://developer.freee.co.jp/',
    notes: 'API連携は2026年Q4以降に対応予定（それまではCSVエクスポートで取り込み可）。',
  },
  money_forward: {
    id: 'money_forward',
    label: 'マネーフォワード',
    category: 'accounting',
    direction: 'two_way',
    status: 'planned',
    surface: 'catalog',
    proOnly: true,
    notes: 'API連携は順次対応（当面はCSVエクスポート）。',
  },
  misoca: {
    id: 'misoca',
    label: 'Misoca',
    category: 'accounting',
    direction: 'notify',
    status: 'planned',
    surface: 'catalog',
    proOnly: true,
    notes: '請求書発行との連携。順次対応。',
  },
}

/** 表示順を保った全ツール定義。 */
export function listIntegrations(): IntegrationDefinition[] {
  return ALL_INTEGRATION_IDS.map((id) => INTEGRATIONS[id])
}

/** カテゴリ順にグルーピングした一覧（レール描画用）。空カテゴリは含めない。 */
export function integrationsByCategory(): { category: IntegrationCategory; items: IntegrationDefinition[] }[] {
  return CATEGORY_ORDER.map((category) => ({
    category,
    items: listIntegrations().filter((d) => d.category === category),
  })).filter((g) => g.items.length > 0)
}

/**
 * 主要ツールだけ（表示順を保つ）。UIの初期表示に使い、残りは「すべて表示」で開く。
 * 対応ツールが増えても最初の画面が長大にならないようにするための表示制御。
 */
export function featuredIntegrations(): IntegrationDefinition[] {
  return listIntegrations().filter((d) => d.featured === true)
}

/** 実際に接続できる（planned を除く）ツールだけ。 */
export function availableIntegrations(): IntegrationDefinition[] {
  return listIntegrations().filter((d) => d.status !== 'planned')
}

export function getIntegration(id: string): IntegrationDefinition | null {
  return isIntegrationId(id) ? INTEGRATIONS[id] : null
}

export function isIntegrationId(value: string): value is IntegrationId {
  return (ALL_INTEGRATION_IDS as readonly string[]).includes(value)
}

/** sinkProvider から対応するツール定義を引く（sink詳細→カタログの逆引き）。 */
export function getIntegrationBySinkProvider(provider: SinkProvider): IntegrationDefinition | null {
  return listIntegrations().find((d) => d.surface === 'sink' && d.sinkProvider === provider) ?? null
}
