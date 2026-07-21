import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 期限リマインドのデータアクセス層（service role専用・PR-0のスキーマ/RPCをそのまま呼ぶだけ。
 * 新規migration/RPC/トリガーは追加しない）。
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function chain(response: any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {}
  for (const m of ['select', 'eq', 'neq', 'not', 'gte', 'lte', 'lt', 'in', 'limit', 'order', 'upsert']) {
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

  it('spaces!inner(org_id)を埋め込みで取得する（perf是正: 別途space→org往復解決をしない）', async () => {
    fromResponse = { data: [], error: null }
    fromMock.mockImplementation(() => chain(fromResponse))
    await store.findDueReminderCandidateTasks()

    const call = fromMock.mock.results[0].value
    expect(call.select).toHaveBeenCalledWith(
      expect.stringContaining('spaces!inner(org_id)'),
    )
  })

  it('行をキャメルケースへマップする（spaces!inner(org_id)埋め込みからorgIdを含む）', async () => {
    fromResponse = {
      data: [
        {
          id: 't-1',
          due_date: '2026-07-25',
          status: 'todo',
          assignee_id: 'u-1',
          spaces: { org_id: 'org-1' },
        },
      ],
      error: null,
    }
    fromMock.mockImplementation(() => chain(fromResponse))
    const rows = await store.findDueReminderCandidateTasks()
    expect(rows).toEqual([
      { id: 't-1', dueDate: '2026-07-25', status: 'todo', assigneeId: 'u-1', orgId: 'org-1' },
    ])
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

describe('findOrgIdsWithDueRemindersDisabled（org単位の自動期限リマインドオンオフ・全量取得・perf是正: 引数無しでoffのorgだけ返す）', () => {
  it('due_reminders_enabled=falseの行だけを無効集合に含める（引数を取らず全件から絞る）', async () => {
    fromResponse = { data: [{ org_id: 'org-1' }], error: null }
    fromMock.mockImplementation(() => chain(fromResponse))
    const result = await store.findOrgIdsWithDueRemindersDisabled()
    expect(fromMock).toHaveBeenCalledWith('org_channel_policy')
    const call = fromMock.mock.results[0].value
    expect(call.eq).toHaveBeenCalledWith('due_reminders_enabled', false)
    expect(result.has('org-1')).toBe(true)
  })

  it('該当行が無ければ空Setを返す', async () => {
    fromResponse = { data: [], error: null }
    fromMock.mockImplementation(() => chain(fromResponse))
    const result = await store.findOrgIdsWithDueRemindersDisabled()
    expect(result.size).toBe(0)
  })

  it('HIGH-2是正: DBエラーはthrowせず空集合(fail-open・無効なorgは無い扱い)を返す', async () => {
    fromResponse = { data: null, error: { message: 'column due_reminders_enabled does not exist' } }
    fromMock.mockImplementation(() => chain(fromResponse))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await store.findOrgIdsWithDueRemindersDisabled()

    expect(result.size).toBe(0)
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})

describe('isOrgDueRemindersEnabled（org単位の自動期限リマインドオンオフ・単票・senderの送信直前ゲート）', () => {
  it('due_reminders_enabled=falseならfalseを返す', async () => {
    fromResponse = { data: { due_reminders_enabled: false }, error: null }
    fromMock.mockImplementation(() => chain(fromResponse))
    expect(await store.isOrgDueRemindersEnabled('org-1')).toBe(false)
    expect(fromMock).toHaveBeenCalledWith('org_channel_policy')
  })

  it('due_reminders_enabled=trueならtrueを返す', async () => {
    fromResponse = { data: { due_reminders_enabled: true }, error: null }
    fromMock.mockImplementation(() => chain(fromResponse))
    expect(await store.isOrgDueRemindersEnabled('org-1')).toBe(true)
  })

  it('行が無ければfail-open(true)を返す', async () => {
    fromResponse = { data: null, error: null }
    fromMock.mockImplementation(() => chain(fromResponse))
    expect(await store.isOrgDueRemindersEnabled('org-x')).toBe(true)
  })

  it('due_reminders_enabledがnullでもfail-open(true)を返す', async () => {
    fromResponse = { data: { due_reminders_enabled: null }, error: null }
    fromMock.mockImplementation(() => chain(fromResponse))
    expect(await store.isOrgDueRemindersEnabled('org-1')).toBe(true)
  })

  it('HIGH-2是正: DBエラーはthrowせずfail-open(true=有効扱い)を返す(退行回帰テスト)', async () => {
    fromResponse = { data: null, error: { message: 'column due_reminders_enabled does not exist' } }
    fromMock.mockImplementation(() => chain(fromResponse))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await store.isOrgDueRemindersEnabled('org-1')

    expect(result).toBe(true)
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})

describe('findDueReminderDisabledUserIds（個人オプトアウトのbatch版・digest安全網gating用）', () => {
  it('空配列ならクエリせず空Setを返す', async () => {
    const result = await store.findDueReminderDisabledUserIds([])
    expect(result.size).toBe(0)
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('due_reminder_enabled=falseの行だけを無効集合に含める', async () => {
    fromResponse = {
      data: [
        { id: 'u-1', due_reminder_enabled: false },
        { id: 'u-2', due_reminder_enabled: true },
      ],
      error: null,
    }
    fromMock.mockImplementation(() => chain(fromResponse))
    const result = await store.findDueReminderDisabledUserIds(['u-1', 'u-2'])
    expect(result.has('u-1')).toBe(true)
    expect(result.has('u-2')).toBe(false)
  })

  it('行が無い/nullは無効集合に含めない(fail-open)', async () => {
    fromResponse = { data: [{ id: 'u-3', due_reminder_enabled: null }], error: null }
    fromMock.mockImplementation(() => chain(fromResponse))
    const result = await store.findDueReminderDisabledUserIds(['u-3'])
    expect(result.has('u-3')).toBe(false)
  })

  it('DBエラーはthrowする', async () => {
    fromResponse = { data: null, error: { message: 'boom' } }
    fromMock.mockImplementation(() => chain(fromResponse))
    await expect(store.findDueReminderDisabledUserIds(['u-1'])).rejects.toThrow(
      /due_reminder_enabled batch lookup failed/,
    )
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
    })
  })

  it('DBエラーはthrowする', async () => {
    fromResponse = { data: null, error: { message: 'boom' } }
    fromMock.mockImplementation(() => chain(fromResponse))
    await expect(store.findTaskSnapshotForReminder('t-1')).rejects.toThrow(/snapshot query failed/)
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
    })
  })

  it('見つからなければnull', async () => {
    fromResponse = { data: null, error: null }
    fromMock.mockImplementation(() => chain(fromResponse))
    expect(await store.findConnectionFreshness('conn-x')).toBeNull()
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

describe('findDueDigestTodayCandidatesForSpace（page-perf再レビュー是正: 本日分は専用クエリ+専用limit(25)）', () => {
  it('space×client_scope=deliverable×due_date=today×assignee/status条件で絞り込む（★安全修正）', async () => {
    fromResponse = { data: [], error: null }
    fromMock.mockImplementation(() => chain(fromResponse))
    await store.findDueDigestTodayCandidatesForSpace('space-1', '2026-07-21')

    const call = fromMock.mock.results[0].value
    expect(call.eq).toHaveBeenCalledWith('space_id', 'space-1')
    expect(call.eq).toHaveBeenCalledWith('client_scope', 'deliverable')
    expect(call.not).toHaveBeenCalledWith('due_date', 'is', null)
    expect(call.not).toHaveBeenCalledWith('assignee_id', 'is', null)
    expect(call.neq).toHaveBeenCalledWith('status', 'done')
    expect(call.eq).toHaveBeenCalledWith('due_date', '2026-07-21')
    expect(call.limit).toHaveBeenCalledWith(25)
  })

  it('行をマップする（assignee_idを含む・per-task DM判定に使う）', async () => {
    fromResponse = {
      data: [
        {
          id: 't-1',
          title: 'A',
          due_date: '2026-07-21',
          assignee_id: 'u-1',
          due_authority_connection_id: 'conn-1',
        },
      ],
      error: null,
    }
    fromMock.mockImplementation(() => chain(fromResponse))
    const rows = await store.findDueDigestTodayCandidatesForSpace('space-1', '2026-07-21')
    expect(rows).toEqual([
      {
        id: 't-1',
        title: 'A',
        dueDate: '2026-07-21',
        assigneeId: 'u-1',
        dueAuthorityConnectionId: 'conn-1',
      },
    ])
  })

  it('DBエラーはthrowする', async () => {
    fromResponse = { data: null, error: { message: 'boom' } }
    fromMock.mockImplementation(() => chain(fromResponse))
    await expect(store.findDueDigestTodayCandidatesForSpace('space-1', '2026-07-21')).rejects.toThrow(
      /due digest today candidate query failed/,
    )
  })
})

describe('findDueDigestOverdueCandidatesForSpace（page-perf再レビュー是正: 超過分は専用クエリ+専用limit(25)・本日分の枠を食い尽くさない）', () => {
  it('space×client_scope=deliverable×due window(下限/todayJst未満)×assignee/status条件で絞り込む（code review #4是正）', async () => {
    fromResponse = { data: [], error: null }
    fromMock.mockImplementation(() => chain(fromResponse))
    await store.findDueDigestOverdueCandidatesForSpace('space-1', '2026-07-14', '2026-07-21')

    const call = fromMock.mock.results[0].value
    expect(call.eq).toHaveBeenCalledWith('space_id', 'space-1')
    expect(call.eq).toHaveBeenCalledWith('client_scope', 'deliverable')
    expect(call.not).toHaveBeenCalledWith('due_date', 'is', null)
    expect(call.not).toHaveBeenCalledWith('assignee_id', 'is', null)
    expect(call.neq).toHaveBeenCalledWith('status', 'done')
    expect(call.gte).toHaveBeenCalledWith('due_date', '2026-07-14')
    expect(call.lt).toHaveBeenCalledWith('due_date', '2026-07-21')
  })

  it('perf是正: due_date昇順に並べ上限25件に絞る（本日分とは別枠）', async () => {
    fromResponse = { data: [], error: null }
    fromMock.mockImplementation(() => chain(fromResponse))
    await store.findDueDigestOverdueCandidatesForSpace('space-1', '2026-07-14', '2026-07-21')

    const call = fromMock.mock.results[0].value
    expect(call.order).toHaveBeenCalledWith('due_date', { ascending: true })
    expect(call.limit).toHaveBeenCalledWith(25)
  })

  it('行をマップする（assignee_idを含む・per-task DM判定に使う）', async () => {
    fromResponse = {
      data: [
        {
          id: 't-1',
          title: 'A',
          due_date: '2026-07-19',
          assignee_id: 'u-1',
          due_authority_connection_id: 'conn-1',
        },
      ],
      error: null,
    }
    fromMock.mockImplementation(() => chain(fromResponse))
    const rows = await store.findDueDigestOverdueCandidatesForSpace('space-1', '2026-07-14', '2026-07-21')
    expect(rows).toEqual([
      {
        id: 't-1',
        title: 'A',
        dueDate: '2026-07-19',
        assigneeId: 'u-1',
        dueAuthorityConnectionId: 'conn-1',
      },
    ])
  })

  it('DBエラーはthrowする', async () => {
    fromResponse = { data: null, error: { message: 'boom' } }
    fromMock.mockImplementation(() => chain(fromResponse))
    await expect(
      store.findDueDigestOverdueCandidatesForSpace('space-1', '2026-07-14', '2026-07-21'),
    ).rejects.toThrow(/due digest overdue candidate query failed/)
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
    })
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
