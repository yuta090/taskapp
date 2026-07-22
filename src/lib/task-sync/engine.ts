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
  /**
   * カーソルと「最後に取り込みが成功した時刻」を前進させる。**利用可能な全コンテナ・全ページが
   * 成功したときだけ**呼ばれる（一部が明示指定の欠落でも、取れた分が全部取り切れていれば呼ぶ）。
   * missingContainers は欠落台帳の最新形（新規欠落の追加・再出現分の削除を反映済み）を同一更新で書く
   * （poll_cursor / last_import_success_at と別更新にすると、成功パスの一貫性が壊れるため）。
   */
  saveCursor(
    connectionId: string,
    cursor: string | null,
    succeededAt: Date,
    missingContainers: Record<string, string>,
  ): Promise<void>
  /**
   * 明示指定されたコンテナが全て欠落しており、何も取得を試みていない（＝鮮度を主張できる根拠が
   * 無い）ときに、欠落台帳だけを更新する。poll_cursor / last_import_success_at には触れない。
   */
  saveMissingContainers(connectionId: string, missingContainers: Record<string, string>): Promise<void>
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
  /** 明示指定されたのに listContainers() に現れなかったコンテナID（このサイクルで検出された分）。 */
  missingContainers?: string[]
  /**
   * まだ設定が完了していない（アダプタが `pendingConfig: true` で通知した）ため、今回の
   * 対象から外したコンテナID（このサイクルで検出された分。運用ログ用。UI側の「未設定」
   * バッジ等が既に可視化を担うため、ここは補助的な運用ログ用途に留める）。
   */
  pendingConfigContainers?: string[]
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
  /**
   * 欠落台帳（前サイクルまでに記録された「欠落判明時点で有効だったカーソル値」）。
   * runner が接続行の import_missing_containers から読んで渡す。未指定は空（＝欠落なし）。
   */
  storedMissing?: Record<string, string>
  /** 取り込み開始時刻。カーソル計算に使う（テスト可能にするため注入する）。 */
  now: Date
}): Promise<ImportResult> {
  const { connectionId, adapter, ctx, targets, store, storedCursor, now } = args
  const storedMissing = args.storedMissing ?? {}
  const result: ImportResult = { created: 0, updated: 0, completed: 0, orphaned: 0, skipped: false }

  if (!targets.targetSpaceId) {
    // 取り込み先が未設定。接続はあるが運用側の設定待ちなので、失敗ではなく skip として静かに返す。
    return { ...result, skipped: true, reason: 'target_space_unset' }
  }

  let available: string[]
  let missing: string[]
  try {
    const resolved = await resolveContainers(adapter, ctx, targets)
    available = resolved.available
    missing = resolved.missing
  } catch (err) {
    return { ...result, skipped: true, reason: `list_containers_failed: ${message(err)}` }
  }

  if (available.length === 0) {
    if (missing.length > 0) {
      // 明示指定が「全て」欠落している。何も取得を試みていない以上、鮮度を主張する根拠が無いので
      // saveCursor は呼ばない。欠落台帳だけは更新する（再共有時に取りこぼさないための記録）。
      const updatedMissing = updateMissingMap(
        storedMissing,
        missing,
        available,
        storedCursor,
        targets.readContainerIds,
      )
      await store.saveMissingContainers(connectionId, updatedMissing)
      return {
        ...result,
        skipped: true,
        reason: `all_containers_missing: ${missing.join(', ')}`,
        missingContainers: missing,
      }
    }
    // 明示指定が無い（列挙の全件が対象）のに列挙自体が0件。運用側の設定待ちであり異常ではない。
    return { ...result, skipped: true, reason: 'no_containers' }
  }

  const since = sinceForFetch(adapter.cursorGranularity, storedCursor)
  // 対応表は接続単位で一度だけ読む（タスクごとに問い合わせるとページ数×件数のクエリになる）。
  const links = await store.loadLinks(connectionId)

  // 「まだ設定が完了していない」(pendingConfig)コンテナのID。取得を試みる前にアダプタが
  // 検知して拒否するため、このサイクルでは0ページも読んでいない（applyExternalTaskは一切呼ばれない）。
  //
  // ⚠ 既知のトレードオフ（意図的な設計判断。欠落台帳(missingContainers)へは統合しない）:
  // pendingConfigのコンテナは「設定済みになるまで存在しないもの」として扱い、欠落台帳のような
  // 「検知時点のカーソル値を記録して再出現時にそこから取り直す」仕組みは持たせない。そのため、
  // 後日ユーザーがマッピングを完了すると、その回のポーリングはその時点の接続カーソル（since）を
  // そのまま使う＝設定完了までに溜まっていた古いレコードの全件バックフィルは保証しない
  // （設定完了後に更新されたレコードからは正しく拾える）。欠落台帳（実在したコンテナが後から
  // 消えた場合の再出現since）と同じ仕組みに寄せて厳密にバックフィルを保証することもできるが、
  // 「まだ一度も設定されたことがない」と「一度動いていたものが消えた」は性質が違う概念であり、
  // 混ぜると欠落台帳の意味論が濁る。今回のスコープは「1つの設定待ちが他のコンテナの同期を
  // 止めない」ことの回復に限定し、バックフィル保証は別の判断が要る課題として残す。
  const pendingConfigContainerIds: string[] = []

  try {
    for (const containerId of available) {
      // 再出現したコンテナ（欠落台帳にエントリがある）は、接続カーソルではなく
      // 「欠落判明時点で有効だった値」を since にして取り直す。これにより、欠落していた間の
      // 変更を取りこぼさない（記録値が空文字＝一度も同期成功していない状態ならフルフェッチになる。
      // sinceForFetch は空文字/nullをどちらも undefined に倒すため特別扱いは不要）。
      const isReappearing = Object.prototype.hasOwnProperty.call(storedMissing, containerId)
      const containerSince = isReappearing
        ? sinceForFetch(adapter.cursorGranularity, storedMissing[containerId] || null)
        : since

      try {
        let cursor: string | undefined
        let pages = 0
        do {
          const page = await adapter.listChangedTasks(ctx, containerId, { since: containerSince, cursor })
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
      } catch (err) {
        if (isPendingConfigError(err)) {
          // ⚠ 「未マッピング(設定途中)」と「マッピングが壊れている(drift)」の区別（最重要）:
          // アダプタが pendingConfig を立てて通知したのは「まだウィザードで設定していない」
          // 正常な設定途中状態（例: kintoneでアプリを追加したがマッピング未確定）。これは
          // このコンテナ1つの問題であり、既に設定済みの他のコンテナの同期まで止める理由が
          // 無い。このコンテナだけを今回の対象から外し、次のコンテナへ進む（接続全体は
          // 落とさない＝1つの設定待ちで「死んだ接続」化するのを防ぐ）。
          // 一方 pendingConfig が立っていない恒久失敗（drift等）は、この catch を素通りせず
          // 下の外側 catch へ再送出し、従来どおり接続全体を止める（挙動は変えない）。
          pendingConfigContainerIds.push(containerId)
          continue
        }
        throw err
      }
    }
  } catch (err) {
    // 一時失敗。カーソルを進めず次回同じ範囲を取り直す（部分成功でも前進させない）。欠落台帳も
    // 一切書き込まない（このサイクルで何が起きたかを未確定のまま反映しないため）。
    return { ...result, skipped: true, reason: `fetch_failed: ${message(err)}` }
  }

  if (pendingConfigContainerIds.length === available.length) {
    // 利用可能なはずのコンテナが全て設定待ち(pendingConfig)。1件も取得を試みていない以上、
    // 鮮度(last_import_success_at)を主張する根拠が無いので saveCursor は呼ばない
    // （all_containers_missing と同じ考え方。運用ログに理由を残す。UI側の「未設定」バッジが
    // 個々のコンテナの状態を可視化するため、ここでの追加の台帳書き込みは行わない）。
    return {
      ...result,
      skipped: true,
      reason: `all_containers_pending_config: ${pendingConfigContainerIds.join(', ')}`,
      pendingConfigContainers: pendingConfigContainerIds,
    }
  }

  // 利用可能な全コンテナ（設定待ちを除く）が取り切れた。明示指定の一部が欠落していても
  // （missing 非空）、取れた分は取れた分として前進させる — 欠落コンテナが恒久的に消えたままでも、
  // 他のコンテナの取り込みと鮮度証明(last_import_success_at)が凍結してはならない（期限リマインドが
  // 接続単位で恒久停止する回帰を防ぐ）。欠落台帳は「新規欠落を追加（既存エントリは上書きしない＝
  // 最初に欠落と判明した時点の値を保持する）」「再出現して取り切れたコンテナのエントリを削除」を
  // 同時に反映する。
  //
  // ⚠ availableIds には「本当に取得を試みて成功した」コンテナだけを渡す（pendingConfig で今回
  // 対象から外したコンテナは含めない）。含めてしまうと、そのコンテナが仮に別経路（欠落台帳）にも
  // 記録されていた場合、実際には何も取得していないのに欠落エントリを誤って消してしまう。
  const syncedContainerIds = available.filter((id) => !pendingConfigContainerIds.includes(id))
  const updatedMissing = updateMissingMap(
    storedMissing,
    missing,
    syncedContainerIds,
    storedCursor,
    targets.readContainerIds,
  )
  await store.saveCursor(connectionId, advanceCursor(adapter.cursorGranularity, now), now, updatedMissing)
  return {
    ...result,
    missingContainers: missing.length > 0 ? missing : undefined,
    pendingConfigContainers: pendingConfigContainerIds.length > 0 ? pendingConfigContainerIds : undefined,
  }
}

/** err が「まだ設定が完了していない」ことをアダプタが通知した ProviderError かどうか。 */
function isPendingConfigError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { pendingConfig?: boolean }).pendingConfig === true
}

/** resolveContainers の結果。 */
interface ContainerResolution {
  /** 実際に取り込みを行うコンテナID（listContainers() に実在するもの）。 */
  available: string[]
  /**
   * 明示指定されたのに listContainers() に現れなかったコンテナID。
   * 非空でも取り込み自体は available 分は必ず行う（欠落は無視ではなく台帳に記録するだけ）。
   */
  missing: string[]
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
      available: targets.readContainerIds.filter((id) => real.has(id)),
      missing: targets.readContainerIds.filter((id) => !real.has(id)),
    }
  }
  return { available: (await adapter.listContainers(ctx)).map((c) => c.id), missing: [] }
}

/**
 * 欠落台帳を更新する。
 *   - missingIds のうち既存エントリが無いものだけ追加する（cursorAtDetection ?? '' を記録。
 *     既にエントリがあるIDは上書きしない＝「最初に欠落と判明した時点」のカーソル値を保持する。
 *     これが無いと、恒久削除が続くコンテナのサイクルごとに記録値が新しく上書きされ続け、
 *     再共有時の since がどんどん先送りされて取りこぼす）。
 *   - availableIds に含まれる（＝このサイクルで取り切れた）IDのエントリは削除する
 *     （再出現して取り切れた、または元々欠落していなかった、のどちらも欠落台帳に残す理由が無い）。
 *   - readContainerIds が明示指定されている場合、その指定に含まれないキーは台帳から削除する
 *     （設定変更でコンテナが指定から外れると available にも missing にも二度と現れず、上の2つの
 *     ルールだけでは永久に残って設定変更を繰り返すたびに単調増加するため）。readContainerIds が
 *     未指定（＝列挙の全件が対象）の場合は「指定から外れた」を判定する基準が無いので掃除しない。
 */
function updateMissingMap(
  existing: Record<string, string>,
  missingIds: string[],
  availableIds: string[],
  cursorAtDetection: string | null,
  readContainerIds?: string[],
): Record<string, string> {
  const next = { ...existing }
  for (const id of missingIds) {
    if (!(id in next)) next[id] = cursorAtDetection ?? ''
  }
  for (const id of availableIds) delete next[id]
  if (readContainerIds && readContainerIds.length > 0) {
    const allowed = new Set(readContainerIds)
    for (const id of Object.keys(next)) {
      if (!allowed.has(id)) delete next[id]
    }
  }
  return next
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
