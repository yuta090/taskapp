import { describe, it, expect, vi } from 'vitest'
import { importConnection, type TaskSyncStore, type ImportTargets } from '@/lib/task-sync/engine'
import type { ExternalTask, ProviderContext, TaskSyncAdapter, TaskPage } from '@/lib/task-sync/types'

/**
 * 取り込みエンジン（provider 非依存）の制御ロジック。
 *
 * ここで固定したいのは「どのツールでも同じであるべき制御」:
 *   - 新規/既存/完了/削除の分岐
 *   - カーソルは**全部取り切ったときだけ**前進する（部分成功で進めると取りこぼす）
 *   - 同一バッチ内の重複（カーソルの重なり）で二重作成しない
 *   - 取り込み先未設定・コンテナ0件は「失敗」ではなく skip
 */

const NOW = new Date(2026, 6, 21, 12, 0, 0)
const CONNECTION_ID = 'conn-1'

function task(over: Partial<ExternalTask> = {}): ExternalTask {
  return {
    externalId: 'x1',
    containerId: 'c1',
    title: '契約書レビュー',
    body: null,
    dueDate: '2026-07-31',
    completed: false,
    ...over,
  }
}

/** 呼び出しを記録するだけの Store。DBを持たずに制御の分岐を網羅する。 */
function fakeStore(links: Array<[string, string]> = []) {
  const calls = {
    created: [] as ExternalTask[],
    updated: [] as Array<{ taskId: string; task: ExternalTask }>,
    completed: [] as string[],
    orphaned: [] as string[],
    cursors: [] as Array<{ cursor: string | null; at: Date }>,
  }
  let seq = 0
  const store: TaskSyncStore = {
    loadLinks: async () => new Map(links),
    createLinkedTask: async ({ task }) => {
      calls.created.push(task)
      return `task-${++seq}`
    },
    updateLinkedTask: async (taskId, task) => {
      calls.updated.push({ taskId, task })
    },
    completeLinkedTask: async (_conn, taskId) => {
      calls.completed.push(taskId)
      return true
    },
    markLinkOrphaned: async (_conn, externalId) => {
      calls.orphaned.push(externalId)
    },
    saveCursor: async (_conn, cursor, at) => {
      calls.cursors.push({ cursor, at })
    },
  }
  return { store, calls }
}

/** 指定ページを順に返すだけのアダプタ。 */
function fakeAdapter(
  pages: TaskPage[],
  over: Partial<Pick<TaskSyncAdapter, 'cursorGranularity'>> = {},
): TaskSyncAdapter {
  let i = 0
  return {
    id: 'backlog',
    authKind: 'api_key',
    hostPolicy: { kind: 'vendor-domain', allowedSuffixes: ['.backlog.jp'] },
    cursorGranularity: over.cursorGranularity ?? 'date',
    listContainers: async () => [
      { id: 'c1', title: 'コンテナ1' },
      { id: 'c2', title: 'コンテナ2' },
    ],
    listChangedTasks: async () => pages[i++] ?? { items: [], nextCursor: null },
    completeTask: async () => {},
  } as TaskSyncAdapter & { deletionMode?: TaskSyncAdapter['deletionMode'] }
}

const ctx: ProviderContext = { credentials: { kind: 'api_key', token: 'k', baseUrl: 'https://e.backlog.jp' } }
const targets: ImportTargets = { targetSpaceId: 'space-1', readContainerIds: ['c1'] }

function run(adapter: TaskSyncAdapter, store: TaskSyncStore, over: Partial<Parameters<typeof importConnection>[0]> = {}) {
  return importConnection({
    connectionId: CONNECTION_ID,
    adapter,
    ctx,
    targets,
    store,
    storedCursor: null,
    now: NOW,
    ...over,
  })
}

describe('importConnection — 取り込みの基本分岐', () => {
  it('未リンクの外部タスクは新規作成される', async () => {
    const { store, calls } = fakeStore()
    const result = await run(fakeAdapter([{ items: [task()], nextCursor: null }]), store)
    expect(result.created).toBe(1)
    expect(calls.created).toHaveLength(1)
    expect(calls.updated).toHaveLength(0)
  })

  it('リンク済みの外部タスクは更新される（重複作成しない）', async () => {
    const { store, calls } = fakeStore([['x1', 'task-existing']])
    const result = await run(fakeAdapter([{ items: [task()], nextCursor: null }]), store)
    expect(result.created).toBe(0)
    expect(result.updated).toBe(1)
    expect(calls.updated[0].taskId).toBe('task-existing')
  })

  it('外部で完了したタスクは更新＋完了の吸収を行う', async () => {
    const { store, calls } = fakeStore([['x1', 'task-existing']])
    const result = await run(fakeAdapter([{ items: [task({ completed: true })], nextCursor: null }]), store)
    expect(result.completed).toBe(1)
    expect(calls.completed).toEqual(['task-existing'])
  })

  it('既に done で条件付き更新が0件なら completed を数えない（0→1遷移だけ数える）', async () => {
    const { store } = fakeStore([['x1', 'task-existing']])
    store.completeLinkedTask = async () => false
    const result = await run(fakeAdapter([{ items: [task({ completed: true })], nextCursor: null }]), store)
    expect(result.completed).toBe(0)
  })

  it('削除を確実に知れるツール(tombstone)では対応だけ切る（タスク行は消さない）', async () => {
    const { store, calls } = fakeStore([['x1', 'task-existing']])
    const adapter = fakeAdapter([{ items: [task({ deleted: true })], nextCursor: null }])
    adapter.deletionMode = 'tombstone'
    const result = await run(adapter, store)
    expect(result.orphaned).toBe(1)
    expect(calls.orphaned).toEqual(['x1'])
    expect(calls.updated).toHaveLength(0)
  })

  it('未リンクの削除タスクは何もしない（存在しない対応を切らない）', async () => {
    const { store, calls } = fakeStore()
    const adapter = fakeAdapter([{ items: [task({ deleted: true })], nextCursor: null }])
    adapter.deletionMode = 'tombstone'
    const result = await run(adapter, store)
    expect(result.orphaned).toBe(0)
    expect(calls.orphaned).toHaveLength(0)
  })

  it('削除を知れないツールが deleted を立てても対応を切らない（生きているタスクを外さない）', async () => {
    // アダプタの不具合で deleted が立つことは起こり得る。宣言が tombstone でない以上、それは
    // 「外部で消えた事実」ではないので信じない。信じて切ると、利用者からは原因不明で同期が
    // 止まったように見える。
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { store, calls } = fakeStore([['x1', 'task-existing']])
    const adapter = fakeAdapter([{ items: [task({ deleted: true })], nextCursor: null }])
    adapter.deletionMode = 'unsupported'
    const result = await run(adapter, store)
    expect(result.orphaned).toBe(0)
    expect(calls.orphaned).toHaveLength(0)
    expect(errorSpy).toHaveBeenCalled() // 矛盾はログに残す
    errorSpy.mockRestore()
  })

  it('同一バッチ内で同じ外部IDを2度見ても1件しか作らない（カーソル重なりの冪等）', async () => {
    const { store, calls } = fakeStore()
    const adapter = fakeAdapter([
      { items: [task()], nextCursor: 'p2' },
      { items: [task()], nextCursor: null },
    ])
    const result = await run(adapter, store)
    expect(result.created).toBe(1)
    expect(result.updated).toBe(1)
    expect(calls.created).toHaveLength(1)
  })
})

describe('importConnection — カーソル前進の条件（取りこぼさないための生命線）', () => {
  it('全ページ取り切ったときだけカーソルを前進させる', async () => {
    const { store, calls } = fakeStore()
    await run(fakeAdapter([{ items: [], nextCursor: null }]), store)
    expect(calls.cursors).toHaveLength(1)
    // date 粒度なので前日まで戻して保存する
    expect(calls.cursors[0].cursor).toBe('2026-07-20')
    expect(calls.cursors[0].at).toBe(NOW)
  })

  it('取得が途中で失敗したらカーソルを進めない（次サイクルで同じ範囲を取り直す）', async () => {
    const { store, calls } = fakeStore()
    const adapter = fakeAdapter([])
    adapter.listChangedTasks = vi.fn().mockRejectedValue(new Error('boom'))
    const result = await run(adapter, store)
    expect(result.skipped).toBe(true)
    expect(result.reason).toContain('fetch_failed')
    expect(calls.cursors).toHaveLength(0)
  })

  it('複数コンテナのうち片方が失敗したら全体のカーソルを進めない（部分成功で前進しない）', async () => {
    const { store, calls } = fakeStore()
    const adapter = fakeAdapter([])
    let call = 0
    adapter.listChangedTasks = async () => {
      call++
      if (call === 1) return { items: [task()], nextCursor: null }
      throw new Error('second container failed')
    }
    const result = await run(adapter, store, { targets: { targetSpaceId: 'space-1' } })
    expect(result.skipped).toBe(true)
    expect(calls.cursors).toHaveLength(0)
  })

  it('保存済みカーソルは取得条件として渡される', async () => {
    const { store } = fakeStore()
    const adapter = fakeAdapter([{ items: [], nextCursor: null }])
    const spy = vi.fn().mockResolvedValue({ items: [], nextCursor: null })
    adapter.listChangedTasks = spy
    await run(adapter, store, { storedCursor: '2026-07-01' })
    expect(spy).toHaveBeenCalledWith(ctx, 'c1', { since: '2026-07-01', cursor: undefined })
  })

  it('粒度と食い違う形式のカーソルは捨てて全件取得に倒す（wedge回避）', async () => {
    const { store } = fakeStore()
    const adapter = fakeAdapter([{ items: [], nextCursor: null }])
    const spy = vi.fn().mockResolvedValue({ items: [], nextCursor: null })
    adapter.listChangedTasks = spy
    await run(adapter, store, { storedCursor: '2026-07-01T10:00:00.000Z' }) // date 粒度にISO
    expect(spy).toHaveBeenCalledWith(ctx, 'c1', { since: undefined, cursor: undefined })
  })

  it('差分APIを持たないツール(none)はカーソルを保存しない', async () => {
    const { store, calls } = fakeStore()
    await run(fakeAdapter([{ items: [], nextCursor: null }], { cursorGranularity: 'none' }), store)
    expect(calls.cursors[0].cursor).toBeNull()
  })

  it('ちょうど上限枚数で取り切った場合は成功扱いにする（完走しても必ず失敗する接続を作らない）', async () => {
    const { store, calls } = fakeStore()
    const adapter = fakeAdapter([])
    let page = 0
    adapter.listChangedTasks = async () => {
      page++
      // 100ページ目で nextCursor=null＝取り切り。ここを失敗にすると、この規模の接続は
      // 毎回完走してもカーソルが永久に前進しない。
      return { items: [], nextCursor: page < 100 ? String(page) : null }
    }
    const result = await run(adapter, store)
    expect(result.skipped).toBe(false)
    expect(calls.cursors).toHaveLength(1)
  })

  it('カーソルが進まない異常応答でも上限で打ち切り、カーソルは据え置く', async () => {
    const { store, calls } = fakeStore()
    const adapter = fakeAdapter([])
    // 常に nextCursor を返し続ける壊れた実装
    adapter.listChangedTasks = async () => ({ items: [], nextCursor: 'always' })
    const result = await run(adapter, store)
    expect(result.skipped).toBe(true)
    expect(result.reason).toContain('page limit')
    expect(calls.cursors).toHaveLength(0)
  })
})

describe('importConnection — 取り込み対象の解決', () => {
  it('取り込み先スペース未設定なら何もせず skip（失敗ではない）', async () => {
    const { store, calls } = fakeStore()
    const result = await run(fakeAdapter([{ items: [task()], nextCursor: null }]), store, { targets: {} })
    expect(result.skipped).toBe(true)
    expect(result.reason).toBe('target_space_unset')
    expect(calls.created).toHaveLength(0)
  })

  it('コンテナ未指定なら列挙された全コンテナが対象になる', async () => {
    const { store } = fakeStore()
    const adapter = fakeAdapter([])
    const spy = vi.fn().mockResolvedValue({ items: [], nextCursor: null })
    adapter.listChangedTasks = spy
    await run(adapter, store, { targets: { targetSpaceId: 'space-1' } })
    expect(spy.mock.calls.map((c) => c[1])).toEqual(['c1', 'c2'])
  })

  it('実在しないコンテナIDの指定は無視する（取り込み全体を止めない）', async () => {
    const { store } = fakeStore()
    const adapter = fakeAdapter([])
    const spy = vi.fn().mockResolvedValue({ items: [], nextCursor: null })
    adapter.listChangedTasks = spy
    await run(adapter, store, { targets: { targetSpaceId: 'space-1', readContainerIds: ['c1', 'ghost'] } })
    expect(spy.mock.calls.map((c) => c[1])).toEqual(['c1'])
  })

  it('指定が全て実在しなければ skip（誤設定で全件取り込みに化けさせない）', async () => {
    const { store, calls } = fakeStore()
    const result = await run(fakeAdapter([]), store, {
      targets: { targetSpaceId: 'space-1', readContainerIds: ['ghost'] },
    })
    expect(result.skipped).toBe(true)
    expect(result.reason).toBe('no_containers')
    expect(calls.cursors).toHaveLength(0)
  })

  it('コンテナ列挙に失敗したら skip（カーソルは据え置き）', async () => {
    const { store, calls } = fakeStore()
    const adapter = fakeAdapter([])
    adapter.listContainers = vi.fn().mockRejectedValue(new Error('401'))
    const result = await run(adapter, store)
    expect(result.skipped).toBe(true)
    expect(result.reason).toContain('list_containers_failed')
    expect(calls.cursors).toHaveLength(0)
  })
})
