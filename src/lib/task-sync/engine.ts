import { advanceCursor, sinceForFetch } from '@/lib/task-sync/cursor'
import type { DeletionMode, ExternalTask, ProviderContext, TaskSyncAdapter } from '@/lib/task-sync/types'

/**
 * 取り込みエンジン（provider 非依存）。
 *
 * 「外部ツールが正本 → TaskApp へ取り込む」制御をここに一本化する。ツールごとに違うのは
 * 「APIの叩き方」だけであり、差分カーソル・対応表・冪等・完了の吸収・カーソル前進条件といった
 * 制御は全ツールで同一だから（google-tasks/import.ts を各ツールへ複製すると、この共通部分の
 * バグ修正が N 箇所に散る）。
 *
 * DB 依存は TaskSyncStore ポートへ追い出してある。理由は2つ:
 *   1) 資格情報の格納方式・接続テーブルの形が確定する前に、制御ロジックだけ先に固めて
 *      テストで固定したい（DBの形が変わってもこのファイルは変わらない）。
 *   2) 制御の分岐（新規/既存/完了/削除/カーソル前進）をDBなしで網羅テストできる。
 *
 * 既存の connector 層との関係:
 *   - 対応表は connector_task_links、完了の吸収は rpc_connector_complete_task（条件付き更新で
 *     既に done なら0件＝トリガーも発火せずループが物理停止する）を Store 実装が使う。
 *   - 送信（TaskApp → 外部）は connector_jobs アウトボックス側の責務でここでは扱わない。
 */

/** 取り込み先の決定に必要な、接続ごとの共通設定（provider 固有設定は ProviderContext.config）。 */
export interface ImportTargets {
  /** 取り込み先スペース。未設定なら取り込みを行わない（運用側の設定待ち）。 */
  targetSpaceId?: string
  /** 取り込み対象のコンテナID。未指定なら adapter.listContainers() の全件。 */
  readContainerIds?: string[]
  /** 新規作成タスクの既定担当者。 */
  defaultAssigneeId?: string | null
}

/**
 * エンジンが必要とする永続化操作。実装は Supabase を叩くが、エンジンはその形を知らない。
 * 全メソッドは失敗時に throw する（エンジンは throw を「カーソルを進めない」として扱う）。
 */
export interface TaskSyncStore {
  /** この接続の対応表を externalId -> taskId で引けるようにして返す。 */
  loadLinks(connectionId: string): Promise<Map<string, string>>
  /** 外部タスクを新規 TaskApp タスクとして作成し、対応表に登録する。戻り値は task_id。 */
  createLinkedTask(input: {
    connectionId: string
    task: ExternalTask
    targets: ImportTargets
    assigneeId: string | null
  }): Promise<string>
  /** 既存タスクの本文・期日・タイトルを外部の内容に合わせる。 */
  updateLinkedTask(taskId: string, task: ExternalTask): Promise<void>
  /** 完了を吸収する。既に done なら false（＝何も起きなかった）を返す条件付き更新であること。 */
  completeLinkedTask(connectionId: string, taskId: string): Promise<boolean>
  /** 外部で削除されたタスクの対応を切る（タスク行は消さない）。 */
  markLinkOrphaned(connectionId: string, externalId: string): Promise<void>
  /** カーソルと「最後に取り込みが成功した時刻」を前進させる。全ページ成功時のみ呼ばれる。 */
  saveCursor(connectionId: string, cursor: string | null, succeededAt: Date): Promise<void>
}

export interface ImportResult {
  created: number
  updated: number
  completed: number
  orphaned: number
  /** 取り込みを行わなかった（設定未完 / 失敗でカーソル据え置き）。 */
  skipped: boolean
  /** skipped の理由（運用ログ用）。 */
  reason?: string
}

/** 1ページあたりの取得回数の上限。異常なカーソル実装で無限ループしないための安全弁。 */
const MAX_PAGES_PER_CONTAINER = 100

/**
 * 1接続分の取り込みを実行する。
 *
 * カーソル前進の条件（鮮度証明の生命線）: **全コンテナ・全ページを取り切って初めて**前進させる。
 * 途中で失敗したらカーソルを据え置き、次サイクルで同じ範囲を取り直す（取りこぼさない）。
 * これは AI秘書の期限リマインドが「この接続の期限情報は N 分以内に同期済み」と主張するための
 * 根拠（last_import_success_at）と同じ成功パスであり、部分成功で前進させてはならない。
 */
export async function importConnection(args: {
  connectionId: string
  adapter: TaskSyncAdapter
  ctx: ProviderContext
  targets: ImportTargets
  store: TaskSyncStore
  storedCursor: string | null
  /** 取り込み開始時刻。カーソル計算に使う（テスト可能にするため注入する）。 */
  now: Date
}): Promise<ImportResult> {
  const { connectionId, adapter, ctx, targets, store, storedCursor, now } = args
  const result: ImportResult = { created: 0, updated: 0, completed: 0, orphaned: 0, skipped: false }

  if (!targets.targetSpaceId) {
    // 取り込み先が未設定。接続はあるが運用側の設定待ちなので、失敗ではなく skip として静かに返す。
    return { ...result, skipped: true, reason: 'target_space_unset' }
  }

  let containerIds: string[]
  let missingContainerIds: string[]
  try {
    const resolved = await resolveContainers(adapter, ctx, targets)
    containerIds = resolved.containerIds
    missingContainerIds = resolved.missingContainerIds
  } catch (err) {
    return { ...result, skipped: true, reason: `list_containers_failed: ${message(err)}` }
  }
  if (containerIds.length === 0) {
    // 指定が全て欠落していても既存どおり: この時点でカーソルは未前進のまま返る（安全側）。
    return { ...result, skipped: true, reason: 'no_containers' }
  }

  const since = sinceForFetch(adapter.cursorGranularity, storedCursor)
  // 対応表は接続単位で一度だけ読む（タスクごとに問い合わせるとページ数×件数のクエリになる）。
  const links = await store.loadLinks(connectionId)

  try {
    for (const containerId of containerIds) {
      let cursor: string | undefined
      let pages = 0
      do {
        const page = await adapter.listChangedTasks(ctx, containerId, { since, cursor })
        for (const task of page.items) {
          await applyExternalTask({ connectionId, task, deletionMode: adapter.deletionMode, links, targets, store, result })
        }
        cursor = page.nextCursor ?? undefined
        pages++
        // 上限判定は「まだ次ページがある」ときだけ。取り切った最終ページがちょうど上限枚目でも
        // 失敗にしない（ちょうど上限枚で終わる接続が、毎回完走しても必ず失敗と報告されて
        // カーソルが永久に前進しなくなるため）。
        if (cursor && pages >= MAX_PAGES_PER_CONTAINER) {
          // カーソルが進まない実装/異常応答で永久ループするより、今回分を打ち切って次サイクルに回す。
          // カーソルは前進させない（下の throw で成功パスから外れる）ので取りこぼしにはならない。
          throw new Error(`page limit exceeded for container ${containerId}`)
        }
      } while (cursor)
    }
  } catch (err) {
    // 一時失敗。カーソルを進めず次回同じ範囲を取り直す（部分成功でも前進させない）。
    return { ...result, skipped: true, reason: `fetch_failed: ${message(err)}` }
  }

  if (missingContainerIds.length > 0) {
    // 明示指定されたコンテナの一部が listContainers() に現れなかった（Notionでは共有解除された
    // DBが search に出てこない等）。利用可能な分の取り込みは上のループで既に反映済みだが、ここで
    // カーソルを前進させると、欠落しているコンテナの変更が「この接続は同期済み」の範囲に無言で
    // 含まれてしまい、後で再共有しても前進済みカーソルより古い変更を二度と取得できない
    // （取り込みは冪等なので、カーソルを止めたまま再実行されても害は無い）。
    return {
      ...result,
      skipped: true,
      reason:
        `missing_containers: 対象に指定されたコンテナ(${missingContainerIds.join(', ')})が見つかりません。` +
        '共有が外れているか削除された可能性があります。再共有するか設定から外すまでカーソルを進めません',
    }
  }

  await store.saveCursor(connectionId, advanceCursor(adapter.cursorGranularity, now), now)
  return result
}

/** resolveContainers の結果。 */
interface ContainerResolution {
  /** 実際に取り込みを行うコンテナID（listContainers() に実在するもの）。 */
  containerIds: string[]
  /**
   * 明示指定されたのに listContainers() に現れなかったコンテナID。
   * 非空なら、取り込み自体は containerIds 分だけ行うが、呼び出し側はカーソルを前進させない。
   */
  missingContainerIds: string[]
}

/** 取り込み対象コンテナを決める。明示指定があればそれ、無ければ列挙の全件。 */
async function resolveContainers(
  adapter: TaskSyncAdapter,
  ctx: ProviderContext,
  targets: ImportTargets,
): Promise<ContainerResolution> {
  if (targets.readContainerIds && targets.readContainerIds.length > 0) {
    // 実在しないIDが混ざると、そのコンテナの取得が毎回失敗し接続全体の取り込みが止まる（wedge）。
    // 実在するものだけに絞ってこれを防ぐ（gtasks import の read_list_ids と同じ防御）。
    const real = new Set((await adapter.listContainers(ctx)).map((c) => c.id))
    return {
      containerIds: targets.readContainerIds.filter((id) => real.has(id)),
      missingContainerIds: targets.readContainerIds.filter((id) => !real.has(id)),
    }
  }
  return { containerIds: (await adapter.listContainers(ctx)).map((c) => c.id), missingContainerIds: [] }
}

/** 外部タスク1件を TaskApp 側へ反映する。新規/既存/完了/削除の分岐はここだけに置く。 */
async function applyExternalTask(args: {
  connectionId: string
  task: ExternalTask
  deletionMode: DeletionMode | undefined
  links: Map<string, string>
  targets: ImportTargets
  store: TaskSyncStore
  result: ImportResult
}): Promise<void> {
  const { connectionId, task, deletionMode, links, targets, store, result } = args
  const existingTaskId = links.get(task.externalId)

  if (task.deleted) {
    // 削除の扱いは**アダプタの宣言に従う**。宣言が 'tombstone'（削除を確実に知れる）でないのに
    // deleted が立っていたら、それはアダプタ側の不具合であって外部の事実ではない。宣言を信じずに
    // 対応を切ると、生きているタスクを同期対象から外してしまう（利用者からは「同期が止まった」
    // ように見え、原因も分からない）。宣言と矛盾する入力は無視してログに残す。
    if (deletionMode !== 'tombstone') {
      console.error(
        '[task-sync] adapter reported deletion but deletionMode is not tombstone; ignoring:',
        connectionId,
        task.externalId,
      )
      return
    }
    // 外部で消えた。TaskApp 側のタスク行は消さない（作業の記録と証跡は残す）。対応だけ切って、
    // 以後この接続の更新対象から外す。
    if (existingTaskId) {
      await store.markLinkOrphaned(connectionId, task.externalId)
      links.delete(task.externalId)
      result.orphaned++
    }
    return
  }

  if (existingTaskId) {
    await store.updateLinkedTask(existingTaskId, task)
    result.updated++
    if (task.completed) {
      // 条件付き更新。既に done なら false が返り、二重にカウントも通知もしない（0→1遷移のみ）。
      if (await store.completeLinkedTask(connectionId, existingTaskId)) result.completed++
    }
    return
  }

  const taskId = await store.createLinkedTask({
    connectionId,
    task,
    targets,
    assigneeId: targets.defaultAssigneeId ?? null,
  })
  // 同一バッチ内でカーソルの重なりにより同じ外部IDを2度見ても、2件目は既存扱いに倒す（冪等）。
  links.set(task.externalId, taskId)
  result.created++
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
