import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 取り込みランナー（cron の入口）。ここで固定したいのは配線の正しさ:
 *   - アダプタ未実装の provider（gtasks/multica を含む）はこの経路が触らない＝二重取り込みしない
 *   - クロステナント検証を必ず通す
 *   - 資格情報の失効は毒にせず skip
 *   - provider 固有設定は `<provider>_` 接頭辞のキーだけをアダプタへ渡す（他ツールの設定が漏れない）
 *   - 1接続の失敗が他の接続を巻き込まない
 */

const connectionRows: unknown[] = []
const importConnection = vi.fn()
const validateImportTargets = vi.fn()
const resolveCredentials = vi.fn()
const getTaskSyncAdapter = vi.fn()

const pollAttempts: string[] = []
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: async () => ({ data: connectionRows, error: null }),
        }),
      }),
      update: (payload: Record<string, unknown>) => ({
        eq: async (_col: string, id: string) => {
          if (payload.last_poll_attempt_at) pollAttempts.push(id)
          return { error: null }
        },
      }),
    }),
  }),
}))
vi.mock('@/lib/task-sync/engine', () => ({
  importConnection: (...args: unknown[]) => importConnection(...args),
}))
vi.mock('@/lib/task-sync/store', () => ({
  createTaskSyncStore: () => ({}),
  validateImportTargets: (...args: unknown[]) => validateImportTargets(...args),
}))
vi.mock('@/lib/task-sync/credentials', () => ({
  resolveCredentials: (...args: unknown[]) => resolveCredentials(...args),
}))
vi.mock('@/lib/task-sync/adapters', () => ({
  getTaskSyncAdapter: (...args: unknown[]) => getTaskSyncAdapter(...args),
}))

const { runTaskSyncImport } = await import('@/lib/task-sync/runner')

const OK_RESULT = { created: 1, updated: 0, completed: 0, orphaned: 0, skipped: false }

function row(over: Record<string, unknown> = {}) {
  return {
    id: 'conn-1',
    org_id: 'org-1',
    provider: 'backlog',
    auth_kind: 'api_key',
    base_url: 'https://example.backlog.jp',
    access_token_encrypted: 'enc',
    import_config: { target_space_id: 'space-1' },
    poll_cursor: null,
    last_import_success_at: null,
    last_poll_attempt_at: null,
    ...over,
  }
}

beforeEach(() => {
  connectionRows.length = 0
  pollAttempts.length = 0
  importConnection.mockReset().mockResolvedValue(OK_RESULT)
  validateImportTargets.mockReset().mockResolvedValue({ ok: true, assigneeId: null })
  resolveCredentials.mockReset().mockResolvedValue({
    status: 'ok',
    credentials: { kind: 'api_key', token: 'k', baseUrl: 'https://example.backlog.jp' },
  })
  getTaskSyncAdapter.mockReset().mockReturnValue({ id: 'backlog', cursorGranularity: 'date' })
})

describe('runTaskSyncImport — 対象の選別', () => {
  it('専用ワーカー担当(gtasks/multica)は静かに飛ばす（二重取り込みを防ぐ・異常ではない）', async () => {
    connectionRows.push(row({ provider: 'google_tasks' }))
    getTaskSyncAdapter.mockReturnValue(null)
    const summary = await runTaskSyncImport()
    expect(summary.connections).toBe(0)
    expect(summary.skipped).toBe(0)
    expect(importConnection).not.toHaveBeenCalled()
  })

  it('担当外でもない未知 provider は観測できる形で記録する（永久に同期されない接続を隠さない）', async () => {
    // DBの provider 列は形式チェックのみになったため、想定外の値が入り得る。黙って飛ばすと
    // 「接続済みに見えるのに一生同期されない」状態に誰も気づけない。
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    connectionRows.push(row({ provider: 'typo_tool' }))
    getTaskSyncAdapter.mockReturnValue(null)
    const summary = await runTaskSyncImport()
    expect(summary.skipped).toBe(1)
    expect(summary.reasons[0]).toContain('unknown_provider')
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('アダプタ実装済みの接続は取り込みを実行する', async () => {
    connectionRows.push(row())
    const summary = await runTaskSyncImport()
    expect(summary.connections).toBe(1)
    expect(summary.created).toBe(1)
    expect(importConnection).toHaveBeenCalledTimes(1)
  })
})

describe('runTaskSyncImport — ツール固有の呼び出し上限', () => {
  it('最短間隔を宣言したツールは、その間隔を過ぎるまで叩かない（月次上限のあるツールを守る）', async () => {
    // Jooto は標準プランで月100回。cronの15分間隔で回すと数日で上限に達し、以後まったく
    // 同期できなくなる。宣言された最短間隔を過ぎるまでは見送る。
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    connectionRows.push(row({ provider: 'jooto', last_poll_attempt_at: oneHourAgo }))
    getTaskSyncAdapter.mockReturnValue({ id: 'jooto', cursorGranularity: 'none', minPollIntervalMinutes: 1440 })
    const summary = await runTaskSyncImport()
    expect(importConnection).not.toHaveBeenCalled()
    // 失敗ではないので skip にも数えない（毎サイクル積み上がると本当の異常が埋もれる）。
    expect(summary.skipped).toBe(0)
    expect(summary.connections).toBe(0)
  })

  it('最短間隔を過ぎていれば叩く', async () => {
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
    connectionRows.push(row({ provider: 'jooto', last_poll_attempt_at: twoDaysAgo }))
    getTaskSyncAdapter.mockReturnValue({ id: 'jooto', cursorGranularity: 'none', minPollIntervalMinutes: 1440 })
    await runTaskSyncImport()
    expect(importConnection).toHaveBeenCalledTimes(1)
  })

  it('一度も試行していない接続は間隔に関係なく叩く（初回同期を待たせない）', async () => {
    connectionRows.push(row({ provider: 'jooto', last_poll_attempt_at: null }))
    getTaskSyncAdapter.mockReturnValue({ id: 'jooto', cursorGranularity: 'none', minPollIntervalMinutes: 1440 })
    await runTaskSyncImport()
    expect(importConnection).toHaveBeenCalledTimes(1)
  })

  it('最短間隔を宣言していないツールは毎サイクル叩く', async () => {
    connectionRows.push(row({ last_poll_attempt_at: new Date().toISOString() }))
    await runTaskSyncImport()
    expect(importConnection).toHaveBeenCalledTimes(1)
  })

  it('間隔の判定に「成功時刻」ではなく「試行時刻」を使う（失敗ループで上限を食い潰さない）', async () => {
    // 一度も成功していないが直前に試行済み＝失敗し続けている接続。成功時刻で判定すると
    // 毎サイクル叩き続け、呼び出し回数の上限がある相手では一番効かせたい場面で効かない。
    connectionRows.push(
      row({
        provider: 'jooto',
        last_import_success_at: null,
        last_poll_attempt_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      }),
    )
    getTaskSyncAdapter.mockReturnValue({ id: 'jooto', cursorGranularity: 'none', minPollIntervalMinutes: 1440 })
    await runTaskSyncImport()
    expect(importConnection).not.toHaveBeenCalled()
  })

  it('未来の試行時刻（壊れた値）でも叩く（1行の異常値で永久に同期が止まらない）', async () => {
    connectionRows.push(
      row({ provider: 'jooto', last_poll_attempt_at: new Date(Date.now() + 86_400_000).toISOString() }),
    )
    getTaskSyncAdapter.mockReturnValue({ id: 'jooto', cursorGranularity: 'none', minPollIntervalMinutes: 1440 })
    await runTaskSyncImport()
    expect(importConnection).toHaveBeenCalledTimes(1)
  })

  it('接続設定で間隔を「延ばす」ことはできる（対象数が多い契約で上限を超えないため）', async () => {
    // 呼び出し上限は「回数」であって「間隔」ではない。1サイクルの消費は取り込み対象の数に
    // 比例するため、対象が多い契約ではアダプタ既定の間隔でも上限を超える。運用側が延ばせる。
    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()
    connectionRows.push(
      row({
        last_poll_attempt_at: sixHoursAgo,
        import_config: { target_space_id: 'space-1', min_poll_interval_minutes: 720 },
      }),
    )
    await runTaskSyncImport()
    expect(importConnection).not.toHaveBeenCalled()
  })

  it('接続設定で間隔を「縮める」ことはできない（設定で上限超過＝同期停止を招かせない）', async () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    connectionRows.push(
      row({
        provider: 'jooto',
        last_poll_attempt_at: oneHourAgo,
        import_config: { target_space_id: 'space-1', min_poll_interval_minutes: 1 },
      }),
    )
    getTaskSyncAdapter.mockReturnValue({ id: 'jooto', cursorGranularity: 'none', minPollIntervalMinutes: 1440 })
    await runTaskSyncImport()
    expect(importConnection).not.toHaveBeenCalled()
  })

  it('外部を叩く前に試行時刻を進める（実行が重なった後発を弾く）', async () => {
    connectionRows.push(row())
    await runTaskSyncImport()
    expect(pollAttempts).toEqual(['conn-1'])
  })
})

describe('runTaskSyncImport — 境界と失敗の扱い', () => {
  it('クロステナント検証に落ちたら取り込まない', async () => {
    connectionRows.push(row())
    validateImportTargets.mockResolvedValue({ ok: false, assigneeId: null, reason: 'space_org_mismatch' })
    const summary = await runTaskSyncImport()
    expect(importConnection).not.toHaveBeenCalled()
    expect(summary.skipped).toBe(1)
    expect(summary.reasons[0]).toContain('space_org_mismatch')
  })

  it('資格情報の失効は毒にせず skip する（再接続すれば直るため）', async () => {
    connectionRows.push(row())
    resolveCredentials.mockResolvedValue({ status: 'auth_failed' })
    const summary = await runTaskSyncImport()
    expect(importConnection).not.toHaveBeenCalled()
    expect(summary.reasons[0]).toContain('credentials_auth_failed')
  })

  it('1接続の想定外エラーが他の接続を巻き込まない', async () => {
    connectionRows.push(row({ id: 'conn-1' }), row({ id: 'conn-2' }))
    importConnection.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(OK_RESULT)
    const summary = await runTaskSyncImport()
    expect(summary.connections).toBe(2)
    expect(summary.created).toBe(1)
    expect(summary.skipped).toBe(1)
  })
})

describe('runTaskSyncImport — provider固有設定の受け渡し', () => {
  it('`<provider>_` 接頭辞のキーだけをアダプタへ渡す（他ツールの設定を漏らさない）', async () => {
    connectionRows.push(
      row({
        import_config: {
          target_space_id: 'space-1',
          backlog_done_status_ids: [9],
          trello_done_list_ids: ['x'],
          default_assignee_id: 'user-1',
        },
      }),
    )
    await runTaskSyncImport()
    const arg = importConnection.mock.calls[0][0] as { ctx: { config: Record<string, unknown> } }
    expect(arg.ctx.config).toEqual({ backlog_done_status_ids: [9] })
  })

  it('取り込み対象の入れ物は新旧どちらのキー名でも読む（gtasks 由来の read_list_ids も許容）', async () => {
    connectionRows.push(row({ import_config: { target_space_id: 'space-1', read_list_ids: ['c1'] } }))
    await runTaskSyncImport()
    const arg = importConnection.mock.calls[0][0] as { targets: { readContainerIds?: string[] } }
    expect(arg.targets.readContainerIds).toEqual(['c1'])
  })
})
