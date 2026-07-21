/**
 * タスク同期アダプタ層 — 外部のプロジェクト管理/タスク管理ツールを1つの型で扱うための境界。
 *
 * この製品の生命線は「顧客が既に使っているタスク管理」と滑らかに繋がること（そのうえで
 * TaskApp 固有のボール＝次に誰が動くか、とAI秘書の価値を載せる）。対応ツールは十数〜数十に
 * 増える前提のため、ツールごとに import ワーカーを書き下ろす（google-tasks/import.ts 方式）と
 * 破綻する。ツール固有部分をこのインターフェースの実装（アダプタ）に閉じ込め、取り込み・
 * 書き戻しの制御（差分カーソル・リンク管理・冪等・ループ遮断・バックオフ）は provider 非依存の
 * エンジン側に一本化する。
 *
 * 設計の前提（既存の connector 層をそのまま使う。supabase/migrations/20260720125427_...）:
 *   - 対応表は connector_task_links(connection_id, task_id, external_id, external_list_id)
 *   - 送信は connector_jobs アウトボックス(fold + version + lease + backoff)
 *   - 完了の取り込みは rpc_connector_complete_task（条件付き更新でループが物理停止する）
 * アダプタはこれらを知らない。アダプタが知っているのは「外部APIの叩き方」だけにする。
 */

/** アダプタを持つ（＝双方向タスク同期できる）ツールのID。registry.ts の IntegrationId の部分集合。 */
export type TaskSyncProviderId =
  | 'google_tasks'
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

/**
 * 取り込み対象の入れ物（プロジェクト / ボード / リスト / スペース）。ツールによって呼び名が
 * 違うだけで役割は同じ＝「どこから取り込むか」の選択単位。import_config.read_list_ids に入る。
 */
export interface ExternalContainer {
  id: string
  title: string
}

/**
 * 外部タスクを TaskApp の語彙へ正規化した中間表現。エンジンはこれだけを見て tasks 行を作る。
 *
 * dueDate は必ずローカル日付文字列 'YYYY-MM-DD'（CLAUDE.md: toISOString() 由来のUTC変換で
 * 日本時間が1日ずれる事故を構造的に防ぐため、アダプタ側で日付文字列に落とし切る契約）。
 */
export interface ExternalTask {
  /** 外部側の一意ID。connector_task_links.external_id になる。 */
  externalId: string
  /** 外部側の親コンテナID。connector_task_links.external_list_id になる（完了の書き戻し先特定に使う）。 */
  containerId: string
  title: string
  /** 本文。無ければ null（tasks.description は NOT NULL default '' のためエンジン側で '' に落とす）。 */
  body: string | null
  /** 期日（ローカル日付 'YYYY-MM-DD'）。無ければ null。 */
  dueDate: string | null
  /** 完了しているか。ツール固有のステータス表現はアダプタ内で吸収する。 */
  completed: boolean
  /** 外部側で削除済み（差分APIが tombstone を返すツールのみ）。 */
  deleted?: boolean
  /** 外部側の担当者識別子。将来のユーザー対応付け用に保持するだけで、現状エンジンは使わない。 */
  assigneeKey?: string | null
  /** 外部側の最終更新時刻（監査・鮮度確認用。カーソル計算には使わない）。 */
  updatedAt?: string | null
}

/** 差分取得の1ページ。nextCursor が null ならそのコンテナは取り切り。 */
export interface TaskPage {
  items: ExternalTask[]
  /** 次ページ取得用の不透明カーソル（offset・pageToken・GraphQLカーソルの違いをここで吸収する）。 */
  nextCursor: string | null
}

/**
 * 復号済みの資格情報。取得元（OAuthのtoken-manager / APIキーの暗号化列）はエンジン側の関心事で、
 * アダプタはこの形だけを受け取る。
 *
 * baseUrl は接続先ホストがテナントごとに可変なツール用（Backlog=スペースURL、Redmine=自ホスト、
 * Garoon/kintone=サブドメイン）。固定ホストのツール（Google Tasks 等）では null。
 * ⚠ baseUrl は「ユーザーが入力した任意のURL」になり得るため、実際に fetch する前に SSRF 検証を
 *   通す責務がエンジン側にある（src/lib/sinks/ssrf.ts と同じ境界）。アダプタは検証済みの前提で使う。
 */
export interface ProviderCredentials {
  kind: 'oauth' | 'api_key'
  /** OAuth のアクセストークン、または APIキー/PAT。 */
  token: string
  /** テナント可変ホストのベースURL（例: https://example.backlog.jp）。固定ホストなら null。 */
  baseUrl?: string | null
}

/**
 * アダプタに渡す実行文脈。資格情報と、接続ごとのツール固有設定をまとめる。
 *
 * config を credentials と分けるのは、後者が秘匿値（復号済みトークン）でログにも出せないのに対し、
 * 前者は運用者が画面で設定する可視の値（例: Backlog の「どのステータスを完了とみなすか」、
 * Jira の JQL 範囲）だから。両者の寿命も違う（トークンは失効・再取得、設定は接続の属性）。
 */
export interface ProviderContext {
  credentials: ProviderCredentials
  /**
   * 接続ごとのツール固有設定（integration_connections.import_config のうち provider 固有の部分）。
   * ツールによってはステータスがテナント定義で可変（Backlog のカスタムステータス、Redmine の
   * ステータス、Jira のワークフロー）なため、「完了とみなす値」を固定値で決め打ちできない。
   * その差異をここで吸収する。
   *
   * ⚠ キー名は必ず provider 名を接頭辞に付ける（`backlog_done_status_ids` のように）。
   *   十数のアダプタが同じ袋に設定を入れるため、接頭辞が無いとキーが衝突する。
   *   各アダプタは raw な値を信用せず、自分の関数で1度だけ検証して既定値に倒すこと。
   */
  config?: Record<string, unknown>
}

/** 差分取得の起点。ツールの絞り込み精度に合わせてエンジンがカーソルを作る。 */
export type CursorGranularity = 'timestamp' | 'date' | 'none'

/**
 * 外部で削除されたタスクをどう知れるか。ツールごとに根本的に違い、**知れないツールが多い**。
 *  - tombstone: 差分APIが削除済みフラグ付きで返す（Google Tasks の deleted 等）。
 *  - snapshot:  差分ではなく全件が返るため「今回の応答に無い＝消えた」と断定できる。
 *  - webhook:   push 通知でのみ削除を知れる（ポーリングでは分からない）。
 *  - unsupported: 削除を知る手段が無い。TaskApp 側の対応は残り続ける（実害は少ないが、
 *                 「消したのに残る」ことをUIで説明する必要がある）。
 *
 * この宣言が無いと、エンジンは「差分に出てこない＝削除された」と誤解して正常なタスクの対応を
 * 切ってしまう。区別できないものを区別できると偽らないための型。
 */
export type DeletionMode = 'tombstone' | 'snapshot' | 'webhook' | 'unsupported'

/**
 * アダプタが投げる構造化エラー。HTTP status だけでは再試行の**時刻**を表現できないため分離した。
 *
 * 429 を「ただの一時失敗」に潰すと、レート制限中に固定バックオフで叩き続けて制限を延長する。
 * 外部が教えてくれる復帰時刻（Retry-After / X-RateLimit-Reset）を運べるようにする。
 */
export interface ProviderError extends Error {
  /** HTTP status。呼び出し側が 400/404/422=恒久失敗、他=一時失敗に分類する。 */
  status?: number
  /** 再試行して良くなるまでの待ち時間(ms)。429/503 で外部が示した場合のみ入る。 */
  retryAfterMs?: number
  /** 設定不備など、再試行では直らないことが確実な失敗（恒久失敗として扱う）。 */
  permanent?: boolean
}

/** ProviderError を作る。アダプタはこれを使って例外の形を揃える。 */
export function providerError(
  message: string,
  opts: { status?: number; retryAfterMs?: number; permanent?: boolean } = {},
): ProviderError {
  const err = new Error(message) as ProviderError
  if (opts.status !== undefined) err.status = opts.status
  if (opts.retryAfterMs !== undefined) err.retryAfterMs = opts.retryAfterMs
  if (opts.permanent !== undefined) err.permanent = opts.permanent
  return err
}

/**
 * タスク同期アダプタ。1ツール1実装。
 *
 * 実装の約束:
 *   - HTTP 失敗時は `Error & { status?: number }` を throw する（エンジンが 400/404/422=恒久失敗、
 *     それ以外=一時失敗に分類する。既存 dispatch.ts の classifyError と同じ流儀）。
 *   - 副作用のある操作（completeTask）は 404 を「既に消えている＝完了と同義」として
 *     呼び出し側が握れるよう、status を保った例外にする。
 *   - ページングは nextCursor で表現し、内部形式は外へ漏らさない。
 */
export interface TaskSyncAdapter {
  readonly id: TaskSyncProviderId
  /** 資格情報の方式。接続UIの入力項目（APIキー欄を出すか OAuth ボタンを出すか）を駆動する。 */
  readonly authKind: 'oauth' | 'api_key'
  /** 接続先ホストがテナントごとに可変か（true なら接続時にURL/サブドメインの入力が要る）。 */
  readonly requiresBaseUrl: boolean
  /**
   * 差分取得の粒度。'date' のツールは日付単位でしか絞れず取りこぼし防止に前日から取り直す等の
   * 補正がエンジン側で要る。'none' は差分APIが無く全件取得しかできない。
   */
  readonly cursorGranularity: CursorGranularity
  /**
   * 外部での削除をどう知れるか。省略時は 'unsupported'（知る手段が無い）として扱う。
   * エンジンはこれを見て「差分に出てこないタスク」を消えたとみなすかどうかを決める。
   */
  readonly deletionMode?: DeletionMode

  /** 取り込み対象に選べる入れ物を列挙する。 */
  listContainers(ctx: ProviderContext): Promise<ExternalContainer[]>

  /**
   * 指定コンテナの変更タスクを1ページ取得する。
   * @param since 差分の起点（cursorGranularity に合わせた形式。'timestamp'=ISO8601 / 'date'='YYYY-MM-DD'）
   * @param cursor 前ページの nextCursor
   */
  listChangedTasks(
    ctx: ProviderContext,
    containerId: string,
    opts: { since?: string; cursor?: string },
  ): Promise<TaskPage>

  /** 外部側のタスクを完了にする（TaskApp で完了 → 外部へ書き戻す経路）。 */
  completeTask(ctx: ProviderContext, ref: { externalId: string; containerId: string }): Promise<void>

  /**
   * TaskApp で起票したタスクを外部にも作る（真の双方向）。
   *
   * 省略可なのは、書き込みまで対応できるかがツールと権限に依存するため。省略＝取り込み専用
   * （＝外部が正本の片方向＋完了の書き戻しのみ）であり、UIはそのように説明する必要がある。
   * カタログ上の direction='two_way' は「目指す形」であって、実際の能力はこの有無が真実。
   */
  createTask?(
    ctx: ProviderContext,
    containerId: string,
    input: TaskWriteInput,
  ): Promise<{ externalId: string }>

  /** 外部側のタスク内容（タイトル・本文・期日）を TaskApp の内容に合わせる。 */
  updateTask?(
    ctx: ProviderContext,
    ref: { externalId: string; containerId: string },
    input: TaskWriteInput,
  ): Promise<void>
}

/** 外部へ書き込む内容。undefined のフィールドは「変更しない」を意味する（部分更新）。 */
export interface TaskWriteInput {
  title?: string
  body?: string | null
  /** ローカル日付 'YYYY-MM-DD'。null は期日を外す。 */
  dueDate?: string | null
}
