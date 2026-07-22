import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 期限リマインドのデータアクセス層（service role専用・PR-0のスキーマ/RPCをそのまま呼ぶだけ。
 * 新規migration/RPC/トリガーは追加しない）。
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function chain(response: any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {}
  for (const m of ['select', 'eq', 'neq', 'not', 'gte', 'lte', 'in', 'limit', 'upsert']) {
    builder[m] = vi.fn(() => builder)
  }
  builder.maybeSingle = vi.fn(() => Promise.resolve(response))
  // upsert(...).select('id') はmaybeSingleを呼ばず直接await（thenable）される
  builder.then = (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onFulfilled: (value: any) => unknown,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onRejected?: (reason: any) => unknown,
  ) => Promise.resolve(response).then(onFulfilled, onRejected)
  return builder
}

let fromResponse: unknown
const fromMock = vi.fn()
const rpcMock = vi.fn()

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({ from: fromMock, rpc: rpcMock })),
}))

const store = await import('@/lib/reminders/dueReminderStore')

beforeEach(() => {
  vi.clearAllMocks()
  fromResponse = { data: null, error: null }
  fromMock.mockImplementation(() => chain(fromResponse))
})

describe('findDueReminderCandidateTasks', () => {
  it('due_date IS NOT NULL / status<>done / assignee_id IS NOT NULL で絞り込む', async () => {
    fromResponse = { data: [], error: null }
    fromMock.mockImplementation(() => chain(fromResponse))
    await store.findDueReminderCandidateTasks()

    expect(fromMock).toHaveBeenCalledWith('tasks')
    const call = fromMock.mock.results[0].value
    expect(call.not).toHaveBeenCalledWith('due_date', 'is', null)
    expect(call.neq).toHaveBeenCalledWith('status', 'done')
    expect(call.not).toHaveBeenCalledWith('assignee_id', 'is', null)
  })

  it('行をキャメルケースへマップする', async () => {
    fromResponse = {
      data: [{ id: 't-1', due_date: '2026-07-25', status: 'todo', assignee_id: 'u-1' }],
      error: null,
    }
    fromMock.mockImplementation(() => chain(fromResponse))
    const rows = await store.findDueReminderCandidateTasks()
    expect(rows).toEqual([{ id: 't-1', dueDate: '2026-07-25', status: 'todo', assigneeId: 'u-1' }])
  })

  it('DBエラーはthrowする', async () => {
    fromResponse = { data: null, error: { message: 'boom' } }
    fromMock.mockImplementation(() => chain(fromResponse))
    await expect(store.findDueReminderCandidateTasks()).rejects.toThrow(/candidate query failed/)
  })

  describe('due_date窓（code review #5是正・全org無窓スキャンの回避）', () => {
    it('今日(JST)-2日 〜 +2日の窓を掛ける', async () => {
      fromResponse = { data: [], error: null }
      fromMock.mockImplementation(() => chain(fromResponse))
      const now = new Date('2026-07-20T10:00:00.000Z')
      await store.findDueReminderCandidateTasks(now)

      const call = fromMock.mock.results[0].value
      expect(call.gte).toHaveBeenCalledWith('due_date', '2026-07-18')
      expect(call.lte).toHaveBeenCalledWith('due_date', '2026-07-22')
    })

    it('nowを省略しても窓が掛かる（既定=new Date()）', async () => {
      fromResponse = { data: [], error: null }
      fromMock.mockImplementation(() => chain(fromResponse))
      await store.findDueReminderCandidateTasks()

      const call = fromMock.mock.results[0].value
      expect(call.gte).toHaveBeenCalled()
      expect(call.lte).toHaveBeenCalled()
    })
  })
})

describe('materializeDueReminderOccurrences', () => {
  it('drafts0件ならupsertを呼ばず0を返す', async () => {
    const result = await store.materializeDueReminderOccurrences([])
    expect(result).toBe(0)
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('on conflict do nothing相当(ignoreDuplicates)でupsertし、新規insert件数を返す', async () => {
    fromResponse = { data: [{ id: 'occ-1' }], error: null }
    fromMock.mockImplementation(() => chain(fromResponse))

    const result = await store.materializeDueReminderOccurrences([
      { taskId: 't-1', kind: 'due_today', offsetMinutes: 0, dueSnapshot: '2026-07-25', scheduledAt: '2026-07-25T00:00:00.000Z' },
    ])

    expect(fromMock).toHaveBeenCalledWith('task_due_reminder_occurrences')
    const call = fromMock.mock.results[0].value
    expect(call.upsert).toHaveBeenCalledWith(
      [
        {
          task_id: 't-1',
          kind: 'due_today',
          offset_minutes: 0,
          due_snapshot: '2026-07-25',
          scheduled_at: '2026-07-25T00:00:00.000Z',
        },
      ],
      { onConflict: 'task_id,due_snapshot,offset_minutes', ignoreDuplicates: true },
    )
    expect(result).toBe(1)
  })

  it('同一draftsで2回呼んでも同一の呼び出し契約になる（再実行の冪等性はDBのunique制約に依拠）', async () => {
    fromResponse = { data: [{ id: 'occ-1' }], error: null }
    fromMock.mockImplementation(() => chain(fromResponse))
    const drafts = [
      { taskId: 't-1', kind: 'due_today' as const, offsetMinutes: 0, dueSnapshot: '2026-07-25', scheduledAt: '2026-07-25T00:00:00.000Z' },
    ]

    await store.materializeDueReminderOccurrences(drafts)
    await store.materializeDueReminderOccurrences(drafts)

    const firstCallArgs = fromMock.mock.results[0].value.upsert.mock.calls[0]
    const secondCallArgs = fromMock.mock.results[1].value.upsert.mock.calls[0]
    expect(firstCallArgs).toEqual(secondCallArgs)
  })

  it('DBエラーはthrowする', async () => {
    fromResponse = { data: null, error: { message: 'boom' } }
    fromMock.mockImplementation(() => chain(fromResponse))
    await expect(
      store.materializeDueReminderOccurrences([
        { taskId: 't-1', kind: 'due_today', offsetMinutes: 0, dueSnapshot: '2026-07-25', scheduledAt: '2026-07-25T00:00:00.000Z' },
      ]),
    ).rejects.toThrow(/materialize failed/)
  })
})

describe('findTaskSnapshotForReminder', () => {
  it('見つからなければnull', async () => {
    fromResponse = { data: null, error: null }
    fromMock.mockImplementation(() => chain(fromResponse))
    expect(await store.findTaskSnapshotForReminder('t-1')).toBeNull()
  })

  it('行をマップする（ball不明値はinternalへ丸める）', async () => {
    fromResponse = {
      data: {
        id: 't-1',
        title: '見積書の送付',
        status: 'todo',
        due_date: '2026-07-25',
        assignee_id: 'u-1',
        ball: 'agency',
        space_id: 'space-1',
        due_authority_connection_id: null,
      },
      error: null,
    }
    fromMock.mockImplementation(() => chain(fromResponse))
    const snapshot = await store.findTaskSnapshotForReminder('t-1')
    expect(snapshot).toEqual({
      id: 't-1',
      title: '見積書の送付',
      status: 'todo',
      dueDate: '2026-07-25',
      assigneeId: 'u-1',
      ball: 'internal',
      spaceId: 'space-1',
      dueAuthorityConnectionId: null,
      externalListId: null,
    })
  })

  it('DBエラーはthrowする', async () => {
    fromResponse = { data: null, error: { message: 'boom' } }
    fromMock.mockImplementation(() => chain(fromResponse))
    await expect(store.findTaskSnapshotForReminder('t-1')).rejects.toThrow(/snapshot query failed/)
  })

  describe('external権威タスクの external_list_id 解決（欠落コンテナ抑止の入力）', () => {
    it('due_authority_connection_idが有れば connector_task_links から external_list_id を引いて埋める', async () => {
      const fromResponses: Record<string, unknown> = {
        tasks: {
          data: {
            id: 't-1',
            title: 'Notion同期タスク',
            status: 'todo',
            due_date: '2026-07-25',
            assignee_id: 'u-1',
            ball: 'internal',
            space_id: 'space-1',
            due_authority_connection_id: 'conn-1',
          },
          error: null,
        },
        connector_task_links: { data: { external_list_id: 'list-1' }, error: null },
      }
      fromMock.mockImplementation((table: string) => chain(fromResponses[table] ?? { data: null, error: null }))

      const snapshot = await store.findTaskSnapshotForReminder('t-1')
      expect(snapshot?.externalListId).toBe('list-1')

      const linksCall = fromMock.mock.results.find((r, i) => fromMock.mock.calls[i][0] === 'connector_task_links')
        ?.value
      expect(linksCall.eq).toHaveBeenCalledWith('task_id', 't-1')
      expect(linksCall.eq).toHaveBeenCalledWith('connection_id', 'conn-1')
      expect(linksCall.eq).toHaveBeenCalledWith('state', 'active')
    })

    it('due_authority_connection_idが無ければ connector_task_links は問い合わせず null のまま', async () => {
      fromResponse = {
        data: {
          id: 't-1',
          title: '社内タスク',
          status: 'todo',
          due_date: '2026-07-25',
          assignee_id: 'u-1',
          ball: 'internal',
          space_id: 'space-1',
          due_authority_connection_id: null,
        },
        error: null,
      }
      fromMock.mockImplementation(() => chain(fromResponse))
      await store.findTaskSnapshotForReminder('t-1')
      expect(fromMock).toHaveBeenCalledTimes(1)
      expect(fromMock).not.toHaveBeenCalledWith('connector_task_links')
    })

    it('connector_task_links側のDBエラーはthrowする', async () => {
      const fromResponses: Record<string, unknown> = {
        tasks: {
          data: {
            id: 't-1',
            title: 'Notion同期タスク',
            status: 'todo',
            due_date: '2026-07-25',
            assignee_id: 'u-1',
            ball: 'internal',
            space_id: 'space-1',
            due_authority_connection_id: 'conn-1',
          },
          error: null,
        },
        connector_task_links: { data: null, error: { message: 'boom' } },
      }
      fromMock.mockImplementation((table: string) => chain(fromResponses[table] ?? { data: null, error: null }))
      await expect(store.findTaskSnapshotForReminder('t-1')).rejects.toThrow(/external_list_id lookup failed/)
    })
  })
})

describe('findOrgIdForSpace', () => {
  it('org_idを返す', async () => {
    fromResponse = { data: { org_id: 'org-1' }, error: null }
    fromMock.mockImplementation(() => chain(fromResponse))
    expect(await store.findOrgIdForSpace('space-1')).toBe('org-1')
  })

  it('見つからなければnull', async () => {
    fromResponse = { data: null, error: null }
    fromMock.mockImplementation(() => chain(fromResponse))
    expect(await store.findOrgIdForSpace('space-x')).toBeNull()
  })
})

describe('findConnectionFreshness', () => {
  it('接続情報をマップする', async () => {
    fromResponse = {
      data: { status: 'active', provider: 'google_tasks', last_import_success_at: '2026-07-20T00:00:00.000Z' },
      error: null,
    }
    fromMock.mockImplementation(() => chain(fromResponse))
    expect(await store.findConnectionFreshness('conn-1')).toEqual({
      status: 'active',
      provider: 'google_tasks',
      lastImportSuccessAt: '2026-07-20T00:00:00.000Z',
      importMissingContainers: {},
    })
  })

  it('見つからなければnull', async () => {
    fromResponse = { data: null, error: null }
    fromMock.mockImplementation(() => chain(fromResponse))
    expect(await store.findConnectionFreshness('conn-x')).toBeNull()
  })

  it('import_missing_containersをそのままマップする（欠落コンテナ由来タスクの抑止判定に使う台帳）', async () => {
    fromResponse = {
      data: {
        status: 'active',
        provider: 'notion',
        last_import_success_at: '2026-07-20T00:00:00.000Z',
        import_missing_containers: { 'list-gone': '2026-07-10' },
      },
      error: null,
    }
    fromMock.mockImplementation(() => chain(fromResponse))
    expect(await store.findConnectionFreshness('conn-1')).toEqual({
      status: 'active',
      provider: 'notion',
      lastImportSuccessAt: '2026-07-20T00:00:00.000Z',
      importMissingContainers: { 'list-gone': '2026-07-10' },
    })
  })
})

describe('isDueReminderEnabledForUser（利用者個人ごとの期限リマインドオプトアウト・送信直前の抑止判定）', () => {
  it('profiles.due_reminder_enabled=falseならfalseを返す', async () => {
    fromResponse = { data: { due_reminder_enabled: false }, error: null }
    fromMock.mockImplementation(() => chain(fromResponse))
    expect(await store.isDueReminderEnabledForUser('user-1')).toBe(false)

    expect(fromMock).toHaveBeenCalledWith('profiles')
    const call = fromMock.mock.results[0].value
    expect(call.eq).toHaveBeenCalledWith('id', 'user-1')
  })

  it('profiles.due_reminder_enabled=trueならtrueを返す', async () => {
    fromResponse = { data: { due_reminder_enabled: true }, error: null }
    fromMock.mockImplementation(() => chain(fromResponse))
    expect(await store.isDueReminderEnabledForUser('user-1')).toBe(true)
  })

  it('行が無ければfail-open(true)を返す(既定で受け取る)', async () => {
    fromResponse = { data: null, error: null }
    fromMock.mockImplementation(() => chain(fromResponse))
    expect(await store.isDueReminderEnabledForUser('user-x')).toBe(true)
  })

  it('due_reminder_enabledがnullでもfail-open(true)を返す', async () => {
    fromResponse = { data: { due_reminder_enabled: null }, error: null }
    fromMock.mockImplementation(() => chain(fromResponse))
    expect(await store.isDueReminderEnabledForUser('user-1')).toBe(true)
  })

  it('DBエラーはthrowする', async () => {
    fromResponse = { data: null, error: { message: 'boom' } }
    fromMock.mockImplementation(() => chain(fromResponse))
    await expect(store.isDueReminderEnabledForUser('user-1')).rejects.toThrow(
      /due_reminder_enabled lookup failed/,
    )
  })
})

describe('findDueDigestCandidatesForSpace', () => {
  it('space×due window(下限/上限)×assignee/status条件で絞り込む（code review #4是正）', async () => {
    fromResponse = { data: [], error: null }
    fromMock.mockImplementation(() => chain(fromResponse))
    await store.findDueDigestCandidatesForSpace('space-1', '2026-07-14', '2026-07-21')

    const call = fromMock.mock.results[0].value
    expect(call.eq).toHaveBeenCalledWith('space_id', 'space-1')
    expect(call.not).toHaveBeenCalledWith('due_date', 'is', null)
    expect(call.not).toHaveBeenCalledWith('assignee_id', 'is', null)
    expect(call.neq).toHaveBeenCalledWith('status', 'done')
    expect(call.gte).toHaveBeenCalledWith('due_date', '2026-07-14')
    expect(call.lte).toHaveBeenCalledWith('due_date', '2026-07-21')
  })

  it('行をマップする', async () => {
    fromResponse = {
      data: [
        { id: 't-1', title: 'A', due_date: '2026-07-20', ball: 'client', due_authority_connection_id: 'conn-1' },
      ],
      error: null,
    }
    fromMock.mockImplementation(() => chain(fromResponse))
    const rows = await store.findDueDigestCandidatesForSpace('space-1', '2026-07-14', '2026-07-21')
    expect(rows).toEqual([
      { id: 't-1', title: 'A', dueDate: '2026-07-20', ball: 'client', dueAuthorityConnectionId: 'conn-1' },
    ])
  })
})

describe('findConnectionFreshnessBatch', () => {
  it('空配列ならクエリせず空Mapを返す', async () => {
    const result = await store.findConnectionFreshnessBatch([])
    expect(result.size).toBe(0)
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('重複IDは1回にまとめてinで問い合わせる', async () => {
    fromResponse = { data: [], error: null }
    fromMock.mockImplementation(() => chain(fromResponse))
    await store.findConnectionFreshnessBatch(['c-1', 'c-1', 'c-2'])
    const call = fromMock.mock.results[0].value
    expect(call.in).toHaveBeenCalledWith('id', ['c-1', 'c-2'])
  })

  it('id→接続情報のMapを返す', async () => {
    fromResponse = {
      data: [
        { id: 'c-1', status: 'active', provider: 'google_tasks', last_import_success_at: '2026-07-20T00:00:00.000Z' },
      ],
      error: null,
    }
    fromMock.mockImplementation(() => chain(fromResponse))
    const result = await store.findConnectionFreshnessBatch(['c-1'])
    expect(result.get('c-1')).toEqual({
      status: 'active',
      provider: 'google_tasks',
      lastImportSuccessAt: '2026-07-20T00:00:00.000Z',
      importMissingContainers: {},
    })
  })

  it('import_missing_containersをそのままマップする', async () => {
    fromResponse = {
      data: [
        {
          id: 'c-1',
          status: 'active',
          provider: 'notion',
          last_import_success_at: '2026-07-20T00:00:00.000Z',
          import_missing_containers: { 'list-gone': '2026-07-10' },
        },
      ],
      error: null,
    }
    fromMock.mockImplementation(() => chain(fromResponse))
    const result = await store.findConnectionFreshnessBatch(['c-1'])
    expect(result.get('c-1')?.importMissingContainers).toEqual({ 'list-gone': '2026-07-10' })
  })
})

describe('claimDueReminderOccurrences', () => {
  it('rpc_claim_due_reminder_occurrencesをp_limit/p_now(絶対時刻ISO)で呼ぶ', async () => {
    rpcMock.mockResolvedValue({ data: [], error: null })
    const now = new Date('2026-07-20T00:00:00.000Z')
    await store.claimDueReminderOccurrences(50, now)
    expect(rpcMock).toHaveBeenCalledWith('rpc_claim_due_reminder_occurrences', {
      p_limit: 50,
      p_now: '2026-07-20T00:00:00.000Z',
    })
  })

  it('行をキャメルケースへマップする', async () => {
    rpcMock.mockResolvedValue({
      data: [
        { id: 'occ-1', task_id: 't-1', kind: 'due_today', offset_minutes: 0, due_snapshot: '2026-07-25', send_count: 0 },
      ],
      error: null,
    })
    const rows = await store.claimDueReminderOccurrences(50, new Date())
    expect(rows).toEqual([
      { id: 'occ-1', taskId: 't-1', kind: 'due_today', offsetMinutes: 0, dueSnapshot: '2026-07-25', sendCount: 0 },
    ])
  })

  it('DBエラーはthrowする', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'boom' } })
    await expect(store.claimDueReminderOccurrences(50, new Date())).rejects.toThrow(
      /rpc_claim_due_reminder_occurrences failed/,
    )
  })
})

describe('finalizeDueReminderOccurrence', () => {
  it('rpc_finalize_due_reminder_occurrenceをp_id/p_outcome/p_reasonで呼ぶ', async () => {
    rpcMock.mockResolvedValue({ data: {}, error: null })
    await store.finalizeDueReminderOccurrence('occ-1', 'suppressed', 'done')
    expect(rpcMock).toHaveBeenCalledWith('rpc_finalize_due_reminder_occurrence', {
      p_id: 'occ-1',
      p_outcome: 'suppressed',
      p_reason: 'done',
    })
  })

  it('reason省略時はnullを渡す', async () => {
    rpcMock.mockResolvedValue({ data: {}, error: null })
    await store.finalizeDueReminderOccurrence('occ-1', 'sent')
    expect(rpcMock).toHaveBeenCalledWith('rpc_finalize_due_reminder_occurrence', {
      p_id: 'occ-1',
      p_outcome: 'sent',
      p_reason: null,
    })
  })

  it('DBエラーはthrowする', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'boom' } })
    await expect(store.finalizeDueReminderOccurrence('occ-1', 'sent')).rejects.toThrow(
      /rpc_finalize_due_reminder_occurrence failed/,
    )
  })
})

describe('confirmTaskDoneViaLine（設計正本 §7・PR-2・rpc_confirm_task_done_via_line）', () => {
  it('p_channel_account_id/p_external_user_id/p_task_idで呼ぶ', async () => {
    rpcMock.mockResolvedValue({ data: [{ status: 'done' }], error: null })
    const result = await store.confirmTaskDoneViaLine('acc-1', 'U-1', 'task-1')
    expect(rpcMock).toHaveBeenCalledWith('rpc_confirm_task_done_via_line', {
      p_channel_account_id: 'acc-1',
      p_external_user_id: 'U-1',
      p_task_id: 'task-1',
    })
    expect(result).toEqual({ status: 'done' })
  })

  it('単票(配列でない)の返りにも対応する', async () => {
    rpcMock.mockResolvedValue({ data: { status: 'already_done' }, error: null })
    const result = await store.confirmTaskDoneViaLine('acc-1', 'U-1', 'task-1')
    expect(result).toEqual({ status: 'already_done' })
  })

  it('blocked/forbiddenもそのまま伝える', async () => {
    rpcMock.mockResolvedValue({ data: [{ status: 'blocked' }], error: null })
    expect(await store.confirmTaskDoneViaLine('acc-1', 'U-1', 'task-1')).toEqual({ status: 'blocked' })

    rpcMock.mockResolvedValue({ data: [{ status: 'forbidden' }], error: null })
    expect(await store.confirmTaskDoneViaLine('acc-1', 'U-1', 'task-1')).toEqual({ status: 'forbidden' })
  })

  it('DBエラーはthrowする', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'boom' } })
    await expect(store.confirmTaskDoneViaLine('acc-1', 'U-1', 'task-1')).rejects.toThrow(
      /rpc_confirm_task_done_via_line failed/,
    )
  })
})

describe('snoozeDueReminderViaLine（設計正本 §7・PR-2・rpc_snooze_due_reminder_via_line・code review #2是正）', () => {
  it('p_channel_account_id/p_external_user_id/p_occurrence_id/p_snooze_days/p_expected_send_countで呼ぶ', async () => {
    rpcMock.mockResolvedValue({ data: [{ status: 'snoozed' }], error: null })
    const result = await store.snoozeDueReminderViaLine('acc-1', 'U-1', 'occ-1', 1, 0)
    expect(rpcMock).toHaveBeenCalledWith('rpc_snooze_due_reminder_via_line', {
      p_channel_account_id: 'acc-1',
      p_external_user_id: 'U-1',
      p_occurrence_id: 'occ-1',
      p_snooze_days: 1,
      p_expected_send_count: 0,
    })
    expect(result).toEqual({ status: 'snoozed' })
  })

  it('capped/forbidden/not_found/already_snoozedもそのまま伝える', async () => {
    rpcMock.mockResolvedValue({ data: [{ status: 'capped' }], error: null })
    expect(await store.snoozeDueReminderViaLine('acc-1', 'U-1', 'occ-1', 1, 0)).toEqual({ status: 'capped' })

    rpcMock.mockResolvedValue({ data: [{ status: 'forbidden' }], error: null })
    expect(await store.snoozeDueReminderViaLine('acc-1', 'U-1', 'occ-1', 1, 0)).toEqual({ status: 'forbidden' })

    rpcMock.mockResolvedValue({ data: [{ status: 'not_found' }], error: null })
    expect(await store.snoozeDueReminderViaLine('acc-1', 'U-1', 'occ-1', 1, 0)).toEqual({ status: 'not_found' })

    rpcMock.mockResolvedValue({ data: [{ status: 'already_snoozed' }], error: null })
    expect(await store.snoozeDueReminderViaLine('acc-1', 'U-1', 'occ-1', 1, 0)).toEqual({
      status: 'already_snoozed',
    })
  })

  it('DBエラーはthrowする', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'boom' } })
    await expect(store.snoozeDueReminderViaLine('acc-1', 'U-1', 'occ-1', 1, 0)).rejects.toThrow(
      /rpc_snooze_due_reminder_via_line failed/,
    )
  })
})
