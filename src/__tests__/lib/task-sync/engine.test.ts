import { describe, it, expect, vi } from 'vitest'
import { importConnection, type TaskSyncStore, type ImportTargets, type MissingContainerMap } from '@/lib/task-sync/engine'
import { providerError, type ExternalTask, type ProviderContext, type TaskSyncAdapter, type TaskPage } from '@/lib/task-sync/types'

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
    cursors: [] as Array<{ cursor: string | null; at: Date; missing: MissingContainerMap }>,
    missingOnly: [] as Array<MissingContainerMap>,
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
    saveCursor: async (_conn, cursor, at, missing) => {
      calls.cursors.push({ cursor, at, missing })
    },
    saveMissingContainers: async (_conn, missing) => {
      calls.missingOnly.push(missing)
    },
  }
  return { store, calls }
}

/** 指定ページを順に返すだけのアダプタ。 */
function fakeAdapter(
  pages: TaskPage[],
  over: Partial<Pick<TaskSyncAdapter, 'cursorGranularity' | 'deletionMode'>> = {},
): TaskSyncAdapter {
  let i = 0
  return {
    id: 'backlog',
    authKind: 'api_key',
    hostPolicy: { kind: 'vendor-domain', allowedSuffixes: ['.backlog.jp'] },
    cursorGranularity: over.cursorGranularity ?? 'date',
    deletionMode: over.deletionMode,
    listContainers: async () => [
      { id: 'c1', title: 'コンテナ1' },
      { id: 'c2', title: 'コンテナ2' },
    ],
    listChangedTasks: async () => pages[i++] ?? { items: [], nextCursor: null },
    completeTask: async () => {},
  }
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
    const adapter = fakeAdapter([{ items: [task({ deleted: true })], nextCursor: null }], {
      deletionMode: 'tombstone',
    })
    const result = await run(adapter, store)
    expect(result.orphaned).toBe(1)
    expect(calls.orphaned).toEqual(['x1'])
    expect(calls.updated).toHaveLength(0)
  })

  it('未リンクの削除タスクは何もしない（存在しない対応を切らない）', async () => {
    const { store, calls } = fakeStore()
    const adapter = fakeAdapter([{ items: [task({ deleted: true })], nextCursor: null }], {
      deletionMode: 'tombstone',
    })
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
    const adapter = fakeAdapter([{ items: [task({ deleted: true })], nextCursor: null }], {
      deletionMode: 'unsupported',
    })
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

  it('指定が全て実在しなければ skip（誤設定で全件取り込みに化けさせない）。欠落台帳には記録する', async () => {
    const { store, calls } = fakeStore()
    const result = await run(fakeAdapter([]), store, {
      targets: { targetSpaceId: 'space-1', readContainerIds: ['ghost'] },
      storedCursor: '2026-07-05',
    })
    expect(result.skipped).toBe(true)
    expect(result.reason).toContain('all_containers_missing')
    expect(result.reason).toContain('ghost')
    expect(calls.cursors).toHaveLength(0)
    expect(calls.missingOnly).toEqual([{ ghost: { cursor: '2026-07-05', reason: 'missing' } }])
  })

  it('明示指定が無く、かつ列挙も0件なら従来どおり no_containers（設定待ちで異常ではない）', async () => {
    const { store, calls } = fakeStore()
    const adapter = fakeAdapter([])
    adapter.listContainers = async () => []
    const result = await run(adapter, store, { targets: { targetSpaceId: 'space-1' } })
    expect(result.skipped).toBe(true)
    expect(result.reason).toBe('no_containers')
    expect(calls.cursors).toHaveLength(0)
    expect(calls.missingOnly).toHaveLength(0)
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

/** 欠落台帳(MissingContainerMap)エントリを作る（テストの見通しをよくする短縮ヘルパー）。 */
function missingEntry(cursor: string, reason: 'missing' | 'pending_config' = 'missing') {
  return { cursor, reason }
}

describe('importConnection — 共有解除等でコンテナが無言で対象外になるのを防ぐ（恒久停止の回帰防止）', () => {
  /**
   * Notion では共有を外されたDBが search(listContainers) に出てこない。積集合による wedge 防止
   * （実在しないIDの指定は無視する）は維持しつつ、欠落を無言にせず**欠落台帳へ記録**する。
   * 恒久的に消えたコンテナが残っていても、利用可能な分は毎サイクル前進し続ける
   * （＝last_import_success_at が凍結せず、期限リマインドの鮮度証明・催促が止まらない）。
   * 再共有時は記録値を since にして取り直すことで取りこぼしを閉じる（取り込みは冪等なので、
   * 重複取得は無害）。
   */

  it('欠落1件＋正常1件: 正常分は取り込まれ saveCursor が呼ばれ、missing に旧カーソル値が記録される', async () => {
    const { store, calls } = fakeStore()
    const adapter = fakeAdapter([{ items: [task()], nextCursor: null }])
    const result = await run(adapter, store, {
      targets: { targetSpaceId: 'space-1', readContainerIds: ['c1', 'c2-gone'] },
      storedCursor: '2026-07-01',
    })
    expect(result.skipped).toBe(false)
    expect(result.created).toBe(1)
    expect(calls.cursors).toHaveLength(1)
    expect(calls.cursors[0].missing).toEqual({ 'c2-gone': missingEntry('2026-07-01') })
    expect(result.missingContainers).toEqual(['c2-gone'])
  })

  it('欠落台帳の記録値は保存済みカーソルが null なら空文字にする（再出現時フルフェッチの合図）', async () => {
    const { store, calls } = fakeStore()
    const adapter = fakeAdapter([{ items: [], nextCursor: null }])
    await run(adapter, store, {
      targets: { targetSpaceId: 'space-1', readContainerIds: ['c1', 'c2-gone'] },
      storedCursor: null,
    })
    expect(calls.cursors[0].missing).toEqual({ 'c2-gone': missingEntry('') })
  })

  it('再出現: listChangedTasks が記録値を since にして呼ばれ、成功後に missing からエントリが消える', async () => {
    const { store, calls } = fakeStore()
    const adapter = fakeAdapter([{ items: [], nextCursor: null }])
    const spy = vi.fn().mockResolvedValue({ items: [], nextCursor: null })
    adapter.listChangedTasks = spy
    const result = await run(adapter, store, {
      targets: { targetSpaceId: 'space-1', readContainerIds: ['c1'] },
      storedCursor: '2026-07-10',
      storedMissing: { c1: missingEntry('2026-07-01') },
    })
    expect(spy).toHaveBeenCalledWith(ctx, 'c1', { since: '2026-07-01', cursor: undefined })
    expect(result.skipped).toBe(false)
    expect(calls.cursors[0].missing).toEqual({})
  })

  it('再出現の取得が途中で失敗したらカーソル前進なし・欠落台帳も書き込まれない（エントリは実質残存）', async () => {
    const { store, calls } = fakeStore()
    const adapter = fakeAdapter([])
    adapter.listChangedTasks = vi.fn().mockRejectedValue(new Error('boom'))
    const result = await run(adapter, store, {
      targets: { targetSpaceId: 'space-1', readContainerIds: ['c1'] },
      storedMissing: { c1: missingEntry('2026-07-01') },
    })
    expect(result.skipped).toBe(true)
    expect(calls.cursors).toHaveLength(0)
    expect(calls.missingOnly).toHaveLength(0)
  })

  it('恒久削除が続いても missing の記録値は上書きされない（wedgeしない。回帰の中心テスト）', async () => {
    // サイクル1: c2-gone が初めて欠落と判明。
    const { store: store1, calls: calls1 } = fakeStore()
    const adapter1 = fakeAdapter([{ items: [], nextCursor: null }])
    const result1 = await run(adapter1, store1, {
      targets: { targetSpaceId: 'space-1', readContainerIds: ['c1', 'c2-gone'] },
      storedCursor: '2026-07-01',
    })
    expect(result1.skipped).toBe(false) // Backlogプロジェクト削除相当でも他コンテナは前進する
    expect(calls1.cursors[0].missing).toEqual({ 'c2-gone': missingEntry('2026-07-01') })

    // サイクル2: カーソルは前サイクルで前進済み、c2-gone は引き続き欠落。
    const { store: store2, calls: calls2 } = fakeStore()
    const adapter2 = fakeAdapter([{ items: [], nextCursor: null }])
    const result2 = await run(adapter2, store2, {
      targets: { targetSpaceId: 'space-1', readContainerIds: ['c1', 'c2-gone'] },
      storedCursor: '2026-07-20',
      storedMissing: { 'c2-gone': missingEntry('2026-07-01') },
    })
    expect(result2.skipped).toBe(false)
    expect(calls2.cursors).toHaveLength(1) // 正常分は前進し続ける＝催促が恒久停止しない
    expect(calls2.cursors[0].missing).toEqual({ 'c2-gone': missingEntry('2026-07-01') }) // 上書きされない
  })

  it('全コンテナ欠落なら saveCursor されず、欠落台帳だけ記録される', async () => {
    const { store, calls } = fakeStore()
    const result = await run(fakeAdapter([]), store, {
      targets: { targetSpaceId: 'space-1', readContainerIds: ['c1-gone', 'c2-gone'] },
      storedCursor: '2026-07-05',
    })
    expect(result.skipped).toBe(true)
    expect(result.reason).toContain('all_containers_missing')
    expect(calls.cursors).toHaveLength(0)
    expect(calls.missingOnly).toEqual([
      { 'c1-gone': missingEntry('2026-07-05'), 'c2-gone': missingEntry('2026-07-05') },
    ])
  })

  it('timestamp粒度でも記録値はstoredCursorそのまま(ISO)で記録され、sinceにもそのまま渡る', async () => {
    const { store, calls } = fakeStore()
    const adapter = fakeAdapter([{ items: [], nextCursor: null }], { cursorGranularity: 'timestamp' })
    await run(adapter, store, {
      targets: { targetSpaceId: 'space-1', readContainerIds: ['c1', 'c2-gone'] },
      storedCursor: '2026-07-01T00:00:00.000Z',
    })
    expect(calls.cursors[0].missing).toEqual({ 'c2-gone': missingEntry('2026-07-01T00:00:00.000Z') })

    const spy = vi.fn().mockResolvedValue({ items: [], nextCursor: null })
    const adapter2 = fakeAdapter([], { cursorGranularity: 'timestamp' })
    adapter2.listChangedTasks = spy
    await run(adapter2, store, {
      targets: { targetSpaceId: 'space-1', readContainerIds: ['c1'] },
      storedMissing: { c1: missingEntry('2026-07-01T00:00:00.000Z') },
    })
    expect(spy).toHaveBeenCalledWith(ctx, 'c1', { since: '2026-07-01T00:00:00.000Z', cursor: undefined })
  })

  it('全件揃っていれば従来どおり前進し、欠落台帳は空のまま', async () => {
    const { store, calls } = fakeStore()
    const adapter = fakeAdapter([
      { items: [], nextCursor: null },
      { items: [], nextCursor: null },
    ])
    const result = await run(adapter, store, {
      targets: { targetSpaceId: 'space-1', readContainerIds: ['c1', 'c2'] },
    })
    expect(result.skipped).toBe(false)
    expect(calls.cursors).toHaveLength(1)
    expect(calls.cursors[0].missing).toEqual({})
  })

  describe('設定から外れたコンテナの台帳エントリの掃除（Nit是正: 単調増加の防止）', () => {
    it('readContainerIdsから外れたキーは成功時に台帳から削除される', async () => {
      const { store, calls } = fakeStore()
      const adapter = fakeAdapter([{ items: [], nextCursor: null }])
      // c2-gone は前サイクルまでの欠落エントリだが、今回の設定(readContainerIds)にはもう含まれない
      // （運用側が設定からコンテナを外した）。
      const result = await run(adapter, store, {
        targets: { targetSpaceId: 'space-1', readContainerIds: ['c1'] },
        storedCursor: '2026-07-01',
        storedMissing: { 'c2-gone': missingEntry('2026-07-01') },
      })
      expect(result.skipped).toBe(false)
      expect(calls.cursors[0].missing).toEqual({})
    })

    it('全コンテナ欠落のskip経路でも、設定から外れた既存エントリは掃除される', async () => {
      const { store, calls } = fakeStore()
      const result = await run(fakeAdapter([]), store, {
        targets: { targetSpaceId: 'space-1', readContainerIds: ['ghost'] },
        storedCursor: '2026-07-05',
        storedMissing: { 'c2-gone': missingEntry('2026-07-01') },
      })
      expect(result.skipped).toBe(true)
      expect(calls.missingOnly).toEqual([{ ghost: missingEntry('2026-07-05') }])
    })

    it('readContainerIdsが未指定なら掃除の基準が無いので、指定から漏れたキーがあっても掃除しない', async () => {
      const { store, calls } = fakeStore()
      // fakeAdapter の listContainers は c1/c2 のみを返す。readContainerIds未指定＝列挙全件が対象。
      const adapter = fakeAdapter([
        { items: [], nextCursor: null },
        { items: [], nextCursor: null },
      ])
      const result = await run(adapter, store, {
        targets: { targetSpaceId: 'space-1' },
        storedCursor: '2026-07-01',
        storedMissing: { 'stale-gone': missingEntry('2026-07-01') },
      })
      expect(result.skipped).toBe(false)
      expect(calls.cursors[0].missing).toEqual({ 'stale-gone': missingEntry('2026-07-01') })
    })
  })
})

/**
 * pendingConfig（「まだ設定が完了していない」コンテナ単位の正常な設定途中状態。例:
 * kintoneでアプリを追加したがマッピングウィザードを未完了）と、それ以外の恒久失敗
 * （マッピングが実スキーマと食い違うdrift等）の区別。
 *
 * 是正前は、アダプタが investigate 前に投げる permanent エラーを全て同列に扱い、1コンテナの
 * 設定待ちで接続全体（既に設定済みの他のコンテナ）の同期まで止まっていた（Codexレビュー指摘）。
 */
describe('importConnection — pendingConfig(未マッピング等、設定途中のコンテナ)は他コンテナを道連れにしない', () => {
  function pendingError(containerId: string) {
    return providerError(`appId=${containerId} は設定待ちです`, {
      permanent: true,
      status: 400,
      pendingConfig: true,
    })
  }

  it('3コンテナのうち1つが未設定(pendingConfig)でも、残り2つは取り込まれカーソルが前進する', async () => {
    const { store, calls } = fakeStore()
    const adapter = fakeAdapter([])
    adapter.listContainers = async () => [
      { id: 'c1', title: 'コンテナ1' },
      { id: 'c2', title: 'コンテナ2(未設定)' },
      { id: 'c3', title: 'コンテナ3' },
    ]
    adapter.listChangedTasks = async (_ctx, containerId) => {
      if (containerId === 'c2') throw pendingError('c2')
      return { items: [task({ externalId: `x-${containerId}`, containerId })], nextCursor: null }
    }

    const result = await run(adapter, store, { targets: { targetSpaceId: 'space-1' } })

    expect(result.skipped).toBe(false)
    // c1・c3 は取り込まれる（c2 の設定待ちに引きずられない）。
    expect(result.created).toBe(2)
    expect(calls.created.map((t) => t.containerId).sort()).toEqual(['c1', 'c3'])
    // カーソルは前進する（部分成功でも、実際に取り切れた分は鮮度を主張してよい）。
    expect(calls.cursors).toHaveLength(1)
    expect(result.pendingConfigContainers).toEqual(['c2'])
  })

  it('全コンテナが未設定(pendingConfig)なら、カーソルを進めずskipする(鮮度を偽らない)', async () => {
    const { store, calls } = fakeStore()
    const adapter = fakeAdapter([])
    adapter.listContainers = async () => [
      { id: 'c1', title: 'コンテナ1' },
      { id: 'c2', title: 'コンテナ2' },
    ]
    adapter.listChangedTasks = async (_ctx, containerId) => {
      throw pendingError(containerId)
    }

    const result = await run(adapter, store, { targets: { targetSpaceId: 'space-1' } })

    expect(result.skipped).toBe(true)
    expect(result.reason).toContain('all_containers_pending_config')
    expect(calls.cursors).toHaveLength(0)
    expect(result.pendingConfigContainers).toEqual(['c1', 'c2'])
  })

  it('pendingConfigを伴わない恒久エラー(driftや実スキーマとの食い違い等)は従来どおり接続全体を止める', async () => {
    const { store, calls } = fakeStore()
    const adapter = fakeAdapter([])
    adapter.listContainers = async () => [
      { id: 'c1', title: 'コンテナ1' },
      { id: 'c2', title: 'コンテナ2(drift)' },
    ]
    let call = 0
    adapter.listChangedTasks = async () => {
      call++
      if (call === 1) return { items: [task()], nextCursor: null }
      // pendingConfig を伴わない permanent エラー（例: マッピングと実スキーマの食い違い）。
      throw providerError('スキーマが食い違っています', { permanent: true, status: 400 })
    }

    const result = await run(adapter, store, { targets: { targetSpaceId: 'space-1' } })

    expect(result.skipped).toBe(true)
    expect(result.reason).toContain('fetch_failed')
    // 部分成功でもカーソルは進めない（従来どおり）。
    expect(calls.cursors).toHaveLength(0)
  })
})

/**
 * pendingConfig(設定待ち)を欠落台帳(MissingContainerMap)へ統合する（外部レビュー指摘・実バグ:
 * 「未設定コンテナがあるとカーソルだけ進み、後から設定しても過去分が取り込まれない」への是正）。
 *
 * 統合前は、pendingConfigのコンテナは欠落台帳に一切記録されなかった。このため、設定待ちの間に
 * 存在したレコードは記録が無く、後日マッピングを完了しても接続カーソル(since)をそのまま使う
 * ことになり、設定完了までに溜まっていたレコードが更新されない限り永久に取り込まれない
 * （静かなデータ欠落）。以後はpendingConfigも「欠落」と同じ仕組み（対象外と判明した時点の
 * カーソル値を記録し、対象に戻ったらそこから取り直す）に乗せ、reasonで区別する。
 */
describe('importConnection — pendingConfigを欠落台帳へ統合する（設定完了時のバックフィル保証）', () => {
  function pendingError(containerId: string) {
    return providerError(`appId=${containerId} は設定待ちです`, {
      permanent: true,
      status: 400,
      pendingConfig: true,
    })
  }

  it('未設定コンテナがあるとき、そのコンテナのカーソル値が台帳に記録される', async () => {
    const { store, calls } = fakeStore()
    const adapter = fakeAdapter([])
    adapter.listContainers = async () => [
      { id: 'c1', title: 'コンテナ1' },
      { id: 'c2', title: 'コンテナ2(未設定)' },
    ]
    adapter.listChangedTasks = async (_ctx, containerId) => {
      if (containerId === 'c2') throw pendingError('c2')
      return { items: [task({ externalId: `x-${containerId}`, containerId })], nextCursor: null }
    }

    const result = await run(adapter, store, {
      targets: { targetSpaceId: 'space-1' },
      storedCursor: '2026-07-10',
    })

    expect(result.skipped).toBe(false)
    expect(calls.cursors).toHaveLength(1)
    // c2(設定待ち)は「対象外と判明した時点で有効だったカーソル値」＋reason='pending_config'で記録される。
    expect(calls.cursors[0].missing).toEqual({ c2: missingEntry('2026-07-10', 'pending_config') })
    expect(result.pendingConfigContainers).toEqual(['c2'])
  })

  it('全コンテナが未設定(pendingConfig)でも台帳には記録される(1件も取得を試みていないのでsaveCursorは呼ばない)', async () => {
    const { store, calls } = fakeStore()
    const adapter = fakeAdapter([])
    adapter.listContainers = async () => [{ id: 'c1', title: 'コンテナ1(未設定)' }]
    adapter.listChangedTasks = async (_ctx, containerId) => {
      throw pendingError(containerId)
    }

    const result = await run(adapter, store, {
      targets: { targetSpaceId: 'space-1' },
      storedCursor: '2026-07-10',
    })

    expect(result.skipped).toBe(true)
    expect(result.reason).toContain('all_containers_pending_config')
    expect(calls.cursors).toHaveLength(0) // 鮮度は主張しない
    expect(calls.missingOnly).toEqual([{ c1: missingEntry('2026-07-10', 'pending_config') }])
  })

  it('後でマッピングを設定すると、記録値から取り直して台帳のエントリが消える', async () => {
    const { store, calls } = fakeStore()
    const adapter = fakeAdapter([{ items: [], nextCursor: null }])
    const spy = vi.fn().mockResolvedValue({ items: [], nextCursor: null })
    adapter.listChangedTasks = spy
    // 前サイクルでc2はpendingConfigとして記録済み。今回はマッピングが完了し、通常どおり取得できる
    // (アダプタは pendingConfig を投げない＝もう設定済み)。
    const result = await run(adapter, store, {
      targets: { targetSpaceId: 'space-1', readContainerIds: ['c1'] },
      storedCursor: '2026-07-20',
      storedMissing: { c1: missingEntry('2026-07-01', 'pending_config') },
    })

    // 設定待ちの間に溜まっていたレコードを取りこぼさないよう、記録値(設定待ちと判明した時点の
    // カーソル値)を since にして取り直す(欠落コンテナの再出現と同じ仕組み)。
    expect(spy).toHaveBeenCalledWith(ctx, 'c1', { since: '2026-07-01', cursor: undefined })
    expect(result.skipped).toBe(false)
    // 取り切れたので台帳のエントリは消える。
    expect(calls.cursors[0].missing).toEqual({})
  })

  it('利用可能なコンテナのカーソルは前進する（wedgeしない。一部が設定待ちのままでも他は進む）', async () => {
    const { store, calls } = fakeStore()
    const adapter = fakeAdapter([])
    adapter.listContainers = async () => [
      { id: 'c1', title: 'コンテナ1' },
      { id: 'c2', title: 'コンテナ2(未設定のまま)' },
    ]
    adapter.listChangedTasks = async (_ctx, containerId) => {
      if (containerId === 'c2') throw pendingError('c2')
      return { items: [], nextCursor: null }
    }

    // サイクル1: c2が初めて設定待ちと判明。
    const result1 = await run(adapter, store, {
      targets: { targetSpaceId: 'space-1' },
      storedCursor: '2026-07-01',
    })
    expect(result1.skipped).toBe(false)
    expect(calls.cursors).toHaveLength(1)
    expect(calls.cursors[0].missing).toEqual({ c2: missingEntry('2026-07-01', 'pending_config') })

    // サイクル2: c2は引き続き未設定。c1は前進し続ける＝催促が恒久停止しない。記録値は上書きされない。
    const result2 = await run(adapter, store, {
      targets: { targetSpaceId: 'space-1' },
      storedCursor: '2026-07-20',
      storedMissing: { c2: missingEntry('2026-07-01', 'pending_config') },
    })
    expect(result2.skipped).toBe(false)
    expect(calls.cursors).toHaveLength(2)
    expect(calls.cursors[1].missing).toEqual({ c2: missingEntry('2026-07-01', 'pending_config') })
  })
})
