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
  | 'kintone'
  | 'generic_inbound'
  // データ書き出し・通知（送りっぱなし）
  | 'webhook'
  | 'notion'
  | 'google_sheets'
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
  'kintone',
  'generic_inbound',
  // data_export
  'webhook',
  'notion',
  'google_sheets',
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
export type IntegrationDirection = 'two_way' | 'inbound' | 'notify' | 'export'

export const DIRECTION_LABEL: Record<IntegrationDirection, string> = {
  two_way: '双方向同期',
  // 受信のみ＝相手から送ってもらう形。こちらから取りに行かないので、外部の状態を能動的に
  // 確認できない（完了の書き戻しもできない）。two_way と混ぜると期待値がずれるので分ける。
  inbound: '取り込み（受信のみ）',
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
 * AI秘書 Stage5 期限リマインド用の capabilities(docs/spec/AI_SECRETARY_STAGE5_DUE_REMINDERS.md
 * §4.5/§5.3/§6)。connectorKind を持つ provider（gtasks/multica のような surface='connector' に加え、
 * sink と task-sync を兼ねる notion のような provider も含む）が持つ。値の追加は connectorKind を
 * 増やすときのみ。
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

/**
 * Notion inbound の想定 poll 間隔（分）。gtasks/multica と同じ汎用タスク同期エンジン
 * （src/lib/task-sync/）に乗るため cron ジョブは共通だが、実際の cron 間隔・スケジュール登録は
 * 本PRの対象外（サーバサイド・コアのみ実装。ワーカー配線は別PR）。鮮度SLAは他コネクタと同じ
 * 「実質的な間隔×2」の考え方で仮置きし、cron 間隔が確定次第ここを合わせる。
 */
const NOTION_IMPORT_POLL_INTERVAL_MINUTES = 15

/**
 * 接続の手間（セットアップ摩擦の順序尺度）。**表示と実装優先度付けのヒントのみ**で、
 * ゲートの真実源ではない（proOnly と同じ地位）。SSRF境界を決める hostPolicy
 * （src/lib/task-sync/types.ts）とは別物: こちらはUX、あちらはセキュリティ境界。混ぜない。
 *
 *  - oauth:          同意画面を通すだけ（運用者の入力なし）
 *  - api_key:        キーを貼るだけ
 *  - host_and_key:   接続先URL/サブドメインの入力＋キー（Backlog・Redmine・kintone）
 *  - schema_mapping: 上に加えて項目の対応付けウィザードが要る。外部側のデータ構造が
 *                    ユーザーごとに違うツール（Notion・kintone・Airtable）はここに入る
 *  - no_api:         公開APIが無い。汎用Webhook（Zapier等の経由）へ案内するしかない
 */
export type IntegrationSetupComplexity = 'oauth' | 'api_key' | 'host_and_key' | 'schema_mapping' | 'no_api'

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
  /**
   * 双方向コネクタ種別。surface に依らず設定可（能力の真実源）。
   * gtasks/multica は専用ワーカー、それ以外は provider 非依存のタスク同期エンジン（src/lib/task-sync/）
   * が担当する。値はアダプタの id と一致させる。
   * sink と task-sync を兼ねる provider（notion）は surface='sink'（通知連携の詳細ペインを使う）の
   * まま connectorKind を持つ＝この製品では「送りっぱなし通知」と「双方向タスク同期」を
   * 同じツールに対して両方提供できる。ただし接続は別々に作るのではなく、**既存の
   * integration_connections 1行（notion接続）を sink と inbound の両方が共有する**（誤って
   * 「別々の接続として設定する」と読める記述をしない。sink送出(src/lib/sinks/adapters/notion.ts)
   * と inbound取り込み(src/lib/task-sync/providers/notion.ts)は同じ access_token_encrypted を
   * 読む前提で書かれている）。
   */
  connectorKind?: IntegrationId
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
  /**
   * 接続の手間。UIの案内文と、実装の優先度付け（摩擦の小さいものから出す）に使う表示ヒント。
   * 課金・能力の真実源ではない。
   */
  setupComplexity?: IntegrationSetupComplexity
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
    setupComplexity: 'oauth',
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
    setupComplexity: 'host_and_key',
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
    status: 'beta',
    surface: 'connector',
    connectorKind: 'backlog',
    setupComplexity: 'host_and_key',
    proOnly: true,
    featured: true,
    setupUrl: 'https://developer.nulab.com/ja/docs/backlog/',
    notes: '日本のSMB/受託で普及するプロジェクト管理。スペースURLとAPIキーで接続する（双方向同期は順次対応）。',
    // 期限を取り込む＝この接続がそのタスクの期限の正本になる。リマインドの鮮度証明は
    // 実ポーリング間隔×2を許容遅延とする（Stage5 §6 と同じ根拠）。
    capabilities: {
      dueImport: true,
      completionWrite: true,
      dueFreshness: 'poll-sla',
      pollFreshnessSlaMinutes: 30,
    },
  },
  jooto: {
    id: 'jooto',
    label: 'Jooto',
    category: 'task_sync',
    direction: 'two_way',
    status: 'beta',
    surface: 'connector',
    connectorKind: 'jooto',
    setupComplexity: 'api_key',
    proOnly: true,
    featured: true,
    setupUrl: 'https://www.jooto.com/',
    notes: '国産のカンバン型タスク管理。APIキーで接続する（双方向同期は順次対応）。',
    // ⚠ 期限の正本にしない（dueImport=false）。Jooto は差分APIが無く、標準プランの月次上限
    // （月100回）に収めるため**1日1回**しか取り込めない。この接続を期限の正本にすると、
    // 最大48時間古い期限を根拠にAI秘書が催促を送りうる — Jooto側で既に完了/期限変更されている
    // のに相手を急かす、という一番やってはいけない誤爆になる。「不確かなら送らない」に従い、
    // タスクの取り込みと完了の書き戻しは行うが、期限リマインドの根拠にはしない。
    // （ビジネスプラン＝呼び出し無制限なら短間隔にできるので、プラン別に開ける余地は残る）
    capabilities: {
      dueImport: false,
      completionWrite: true,
      dueFreshness: 'none',
    },
  },
  jira: {
    id: 'jira',
    label: 'Jira',
    category: 'task_sync',
    direction: 'two_way',
    status: 'beta',
    surface: 'connector',
    connectorKind: 'jira',
    setupComplexity: 'host_and_key',
    proOnly: true,
    featured: true,
    setupUrl: 'https://developer.atlassian.com/cloud/jira/platform/',
    notes: '課題管理の標準。取り込む課題の範囲（プロジェクト/JQL）を指定して同期する。',
    // 期限を取り込む＝この接続がそのタスクの期限の正本になる。リマインドの鮮度証明は
    // 実ポーリング間隔×2を許容遅延とする（Stage5 §6 と同じ根拠）。
    capabilities: {
      dueImport: true,
      completionWrite: true,
      dueFreshness: 'poll-sla',
      pollFreshnessSlaMinutes: 30,
    },
  },
  redmine: {
    id: 'redmine',
    label: 'Redmine',
    category: 'task_sync',
    direction: 'two_way',
    status: 'beta',
    surface: 'connector',
    connectorKind: 'redmine',
    setupComplexity: 'host_and_key',
    proOnly: true,
    featured: true,
    setupUrl: 'https://www.redmine.org/projects/redmine/wiki/Rest_api',
    notes: '自社サーバー運用の定番。サーバーURLとAPIアクセスキーで接続する（自ホストのため接続先の検証を伴う）。',
    // 期限を取り込む＝この接続がそのタスクの期限の正本になる。リマインドの鮮度証明は
    // 実ポーリング間隔×2を許容遅延とする（Stage5 §6 と同じ根拠）。
    capabilities: {
      dueImport: true,
      completionWrite: true,
      dueFreshness: 'poll-sla',
      pollFreshnessSlaMinutes: 30,
    },
  },
  asana: {
    id: 'asana',
    label: 'Asana',
    category: 'task_sync',
    direction: 'two_way',
    status: 'beta',
    surface: 'connector',
    connectorKind: 'asana',
    setupComplexity: 'api_key',
    proOnly: true,
    featured: true,
    setupUrl: 'https://developers.asana.com/docs',
    // 期限を取り込む＝この接続がそのタスクの期限の正本になる。リマインドの鮮度証明は
    // 実ポーリング間隔×2を許容遅延とする（Stage5 §6 と同じ根拠）。
    capabilities: {
      dueImport: true,
      completionWrite: true,
      dueFreshness: 'poll-sla',
      pollFreshnessSlaMinutes: 30,
    },
  },
  trello: {
    id: 'trello',
    label: 'Trello',
    category: 'task_sync',
    direction: 'two_way',
    status: 'beta',
    surface: 'connector',
    connectorKind: 'trello',
    setupComplexity: 'api_key',
    proOnly: true,
    featured: true,
    setupUrl: 'https://developer.atlassian.com/cloud/trello/rest/',
    // 期限を取り込む＝この接続がそのタスクの期限の正本になる。リマインドの鮮度証明は
    // 実ポーリング間隔×2を許容遅延とする（Stage5 §6 と同じ根拠）。
    capabilities: {
      dueImport: true,
      completionWrite: true,
      dueFreshness: 'poll-sla',
      pollFreshnessSlaMinutes: 30,
    },
  },
  microsoft_todo: {
    id: 'microsoft_todo',
    label: 'Microsoft To Do',
    category: 'task_sync',
    direction: 'two_way',
    status: 'planned',
    surface: 'catalog',
    setupComplexity: 'oauth',
    proOnly: true,
    featured: true,
    notes: 'Microsoft 365 環境の標準タスク。Planner との使い分けは接続時に選ぶ。',
  },
  linear: {
    id: 'linear',
    label: 'Linear',
    category: 'task_sync',
    direction: 'two_way',
    status: 'beta',
    surface: 'connector',
    connectorKind: 'linear',
    setupComplexity: 'api_key',
    proOnly: true,
    featured: true,
    setupUrl: 'https://linear.app/developers',
    // 期限を取り込む＝この接続がそのタスクの期限の正本になる。リマインドの鮮度証明は
    // 実ポーリング間隔×2を許容遅延とする（Stage5 §6 と同じ根拠）。
    capabilities: {
      dueImport: true,
      completionWrite: true,
      dueFreshness: 'poll-sla',
      pollFreshnessSlaMinutes: 30,
    },
  },
  wrike: {
    id: 'wrike',
    label: 'Wrike',
    category: 'task_sync',
    direction: 'two_way',
    status: 'planned',
    surface: 'catalog',
    setupComplexity: 'oauth',
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
    setupComplexity: 'api_key',
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
    setupComplexity: 'api_key',
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
    setupComplexity: 'api_key',
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
    setupComplexity: 'host_and_key',
    proOnly: true,
    notes: 'サイボウズ Garoon のToDo。企業内グループウェア利用企業向け。',
  },
  kintone: {
    id: 'kintone',
    label: 'kintone',
    category: 'task_sync',
    direction: 'two_way',
    // ⚠ 公開に戻した理由(旧: status='planned'に留めていた理由): アダプタ本体
    //   (src/lib/task-sync/providers/kintone.ts)とマッピングの提案/保存ロジック
    //   (kintone/mapping.ts・kintone/schema.ts・kintone/mapping/{propose,route}.ts)に加え、
    //   (a) 接続パネル(KintoneConnectPanel.tsx。アプリID(kintone_app_ids)＋アプリ単位のAPIトークンを
    //   複数行で入力させる専用UI)、(b) 接続後にアプリを増減する専用API
    //   (kintone/apps/route.ts。POST/DELETE。疎通確認してから保存する)、(c) 登録済みアプリの
    //   一覧＋マッピングウィザードUI(KintoneAppsPanel.tsx)が揃い、「接続はできたがコンテナ0件・
    //   マッピング未設定で永久に何も同期しない死んだ接続」を作れない導線が完成したため、
    //   'beta'+'connector' に戻す(この判断は registry.test.ts のkintone専用describeで固定する)。
    status: 'beta',
    surface: 'connector',
    connectorKind: 'kintone',
    setupComplexity: 'schema_mapping',
    proOnly: true,
    featured: true,
    setupUrl: 'https://kintone.dev/en/tutorials/introduction-to-kintone-customizations/api-tokens/',
    notes:
      '業務アプリ基盤(kintone)のレコードを取り込んでタスク同期する。フィールドコード＋選択肢名で対応づけるウィザードが要る（選択肢名はkintone側で変更されると対応が壊れる）。APIトークンはアプリ単位で発行するため、接続後もアプリを1つずつ追加・削除できる。',
    // 期限を取り込む＝この接続がそのタスクの期限の正本になる。リマインドの鮮度証明は
    // 実ポーリング間隔×2を許容遅延とする(trello/linearと同じ考え方の仮値。cron間隔確定次第合わせる)。
    capabilities: {
      dueImport: true,
      completionWrite: true,
      dueFreshness: 'poll-sla',
      pollFreshnessSlaMinutes: 30,
    },
  },
  generic_inbound: {
    id: 'generic_inbound',
    label: 'その他のツール（Webhook）',
    category: 'task_sync',
    // 受信のみ。こちらから取りに行かないので、完了の書き戻しも外部状態の確認もできない。
    direction: 'inbound',
    status: 'beta',
    surface: 'connector',
    setupComplexity: 'api_key',
    connectorKind: 'generic_inbound',
    proOnly: true,
    featured: true,
    notes:
      '公開APIが無いツールも、Zapier・Make・n8n などから決まった形のWebhookを送れば取り込めます。送り先URLと署名用の鍵を発行します。',
    // 次にいつ届くかは送信側次第で、こちらからは保証できない。期限の鮮度を証明できないため、
    // 取り込んだ期限を催促の根拠にはしない（正本は立てるので、鮮度チェックで確実に抑止される）。
    capabilities: {
      dueImport: false,
      completionWrite: false,
      dueFreshness: 'none',
    },
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
    // 送りっぱなし通知(sink)に加え、Notion DBを正本としたタスクの双方向同期(inbound取り込み+
    // 完了の書き戻し)にも対応する。surface は据え置き(sink)なので既存の通知連携UIは壊さず、
    // connectorKind でタスク同期エンジン(src/lib/task-sync/providers/notion.ts)にも接続できる。
    direction: 'two_way',
    status: 'ga',
    surface: 'sink',
    sinkProvider: 'notion',
    connectorKind: 'notion',
    featured: true,
    setupUrl: 'https://www.notion.so/my-integrations',
    setupComplexity: 'schema_mapping',
    notes:
      'タスクをNotionデータベースへ送りっぱなしで書き出せるほか、Notion DBを取り込んでタスク同期もできる（プロパティの対応付けが必要）。',
    capabilities: {
      dueImport: true,
      completionWrite: true,
      dueFreshness: 'poll-sla',
      pollFreshnessSlaMinutes: NOTION_IMPORT_POLL_INTERVAL_MINUTES * 2,
    },
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
  airtable: {
    id: 'airtable',
    label: 'Airtable',
    category: 'data_export',
    direction: 'notify',
    status: 'planned',
    surface: 'catalog',
    setupComplexity: 'schema_mapping',
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
