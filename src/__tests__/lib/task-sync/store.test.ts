import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createTaskSyncStore, validateImportTargets } from '@/lib/task-sync/store'
import type { ExternalTask } from '@/lib/task-sync/types'

/**
 * TaskSyncStore の Supabase 実装。既存 google-tasks/import.ts が実地で獲得した不変条件を
 * 引き継げているかを固定する（ここを落とすと、全ツールで同じ事故が起きる）。
 */

const ORG_ID = 'org-1'
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

/** insert/update/select をキャプチャする最小の Supabase スタブ。 */
function stubAdmin(overrides: Record<string, unknown> = {}) {
  const captured: Record<string, unknown> = {}
  const admin = {
    from: (table: string) => ({
      insert: (payload: unknown) => {
        captured[`${table}.insert`] = payload
        const linkError = overrides[`${table}.insertError`] ?? null
        return {
          select: () => ({
            single: async () => ({ data: { id: 'new-task' }, error: null }),
          }),
          // link insert は select を挟まないので、await されたときに解決する形にする
          then: (resolve: (v: unknown) => void) => resolve({ error: linkError }),
        }
      },
      update: (payload: unknown) => {
        captured[`${table}.update`] = payload
        return {
          eq: () => ({
            eq: async () => ({ error: null }),
            then: (resolve: (v: unknown) => void) => resolve({ error: null }),
          }),
        }
      },
      select: () => ({
        eq: () => ({
          eq: async () => ({ data: [], error: null }),
          maybeSingle: async () => ({ data: overrides['maybeSingle'] ?? null, error: null }),
          then: (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
        }),
      }),
      delete: () => ({ eq: async () => ({ error: null }) }),
    }),
    rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
  } as unknown as SupabaseClient
  return { admin, captured }
}

describe('createTaskSyncStore.createLinkedTask — 外部由来タスクの作り方', () => {
  it('本文が無いとき description に null を入れない（NOT NULL違反で取り込みが恒久停止するため）', async () => {
    const { admin, captured } = stubAdmin()
    const store = createTaskSyncStore({ admin, orgId: ORG_ID, dueAuthority: true })
    await store.createLinkedTask({
      connectionId: CONNECTION_ID,
      task: task({ body: null }),
      targets: { targetSpaceId: 'space-1' },
      assigneeId: null,
    })
    expect((captured['tasks.insert'] as Record<string, unknown>).description).toBe('')
  })

  it('顧客ポータルに露出しないよう client_scope=internal で作る', async () => {
    const { admin, captured } = stubAdmin()
    const store = createTaskSyncStore({ admin, orgId: ORG_ID, dueAuthority: false })
    await store.createLinkedTask({
      connectionId: CONNECTION_ID,
      task: task(),
      targets: { targetSpaceId: 'space-1' },
      assigneeId: null,
    })
    const insert = captured['tasks.insert'] as Record<string, unknown>
    expect(insert.client_scope).toBe('internal')
    expect(insert.ball).toBe('internal')
    expect(insert.origin).toBe('internal')
  })

  it('作成者は専用システムユーザー（実ユーザー名義にしない）', async () => {
    const { admin, captured } = stubAdmin()
    const store = createTaskSyncStore({ admin, orgId: ORG_ID, dueAuthority: false })
    await store.createLinkedTask({
      connectionId: CONNECTION_ID,
      task: task(),
      targets: { targetSpaceId: 'space-1' },
      assigneeId: null,
    })
    expect((captured['tasks.insert'] as Record<string, unknown>).created_by).toBeTruthy()
  })

  it('期限を取り込むコネクタのときだけ期限の正本フラグを立てる', async () => {
    const withAuthority = stubAdmin()
    await createTaskSyncStore({ admin: withAuthority.admin, orgId: ORG_ID, dueAuthority: true }).createLinkedTask(
      { connectionId: CONNECTION_ID, task: task(), targets: { targetSpaceId: 'space-1' }, assigneeId: null },
    )
    expect((withAuthority.captured['tasks.insert'] as Record<string, unknown>).due_authority_connection_id).toBe(
      CONNECTION_ID,
    )

    const without = stubAdmin()
    await createTaskSyncStore({ admin: without.admin, orgId: ORG_ID, dueAuthority: false }).createLinkedTask({
      connectionId: CONNECTION_ID,
      task: task(),
      targets: { targetSpaceId: 'space-1' },
      assigneeId: null,
    })
    expect((without.captured['tasks.insert'] as Record<string, unknown>).due_authority_connection_id).toBeNull()
  })

  it('外部で完了済みのタスクは done として作る', async () => {
    const { admin, captured } = stubAdmin()
    await createTaskSyncStore({ admin, orgId: ORG_ID, dueAuthority: false }).createLinkedTask({
      connectionId: CONNECTION_ID,
      task: task({ completed: true }),
      targets: { targetSpaceId: 'space-1' },
      assigneeId: null,
    })
    expect((captured['tasks.insert'] as Record<string, unknown>).status).toBe('done')
  })
})

describe('createTaskSyncStore.updateLinkedTask', () => {
  it('本文が無いときも description は空文字（null を書かない）', async () => {
    const { admin, captured } = stubAdmin()
    await createTaskSyncStore({ admin, orgId: ORG_ID, dueAuthority: false }).updateLinkedTask(
      'task-1',
      task({ body: null }),
    )
    expect((captured['tasks.update'] as Record<string, unknown>).description).toBe('')
  })
})

describe('createTaskSyncStore.completeLinkedTask', () => {
  it('条件付き更新RPCを使い、その戻り値をそのまま返す（0件=false でループを止める）', async () => {
    const { admin } = stubAdmin()
    const store = createTaskSyncStore({ admin, orgId: ORG_ID, dueAuthority: false })
    expect(await store.completeLinkedTask(CONNECTION_ID, 'task-1')).toBe(true)
    expect(admin.rpc).toHaveBeenCalledWith('rpc_connector_complete_task', {
      p_connection_id: CONNECTION_ID,
      p_task_id: 'task-1',
    })
  })
})

describe('createTaskSyncStore.saveCursor', () => {
  it('カーソルと鮮度証明(last_import_success_at)を同じ成功パスで前進させる', async () => {
    const { admin, captured } = stubAdmin()
    const at = new Date(2026, 6, 21, 12, 0, 0)
    await createTaskSyncStore({ admin, orgId: ORG_ID, dueAuthority: false }).saveCursor(
      CONNECTION_ID,
      '2026-07-20',
      at,
    )
    const update = captured['integration_connections.update'] as Record<string, unknown>
    expect(update.poll_cursor).toBe('2026-07-20')
    expect(update.last_import_success_at).toBe(at.toISOString())
  })
})

describe('validateImportTargets — クロステナント境界', () => {
  it('別orgのスペースが指定されていたら取り込みを止める（1件も作らせない）', async () => {
    const { admin } = stubAdmin({ maybeSingle: { org_id: 'other-org' } })
    const res = await validateImportTargets(admin, ORG_ID, { targetSpaceId: 'space-x' })
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('space_org_mismatch')
  })

  it('スペース未設定は取り込み対象外として止める', async () => {
    const { admin } = stubAdmin()
    const res = await validateImportTargets(admin, ORG_ID, {})
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('target_space_unset')
  })

  it('自orgのスペースなら通す', async () => {
    const { admin } = stubAdmin({ maybeSingle: { org_id: ORG_ID } })
    const res = await validateImportTargets(admin, ORG_ID, { targetSpaceId: 'space-1' })
    expect(res.ok).toBe(true)
  })
})
