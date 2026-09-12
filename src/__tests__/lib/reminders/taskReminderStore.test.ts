import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 時刻指定タスクリマインドのデータアクセス層のうち、設定時ゲートで使う findTaskOrgId。
 * tasks と spaces をつなぐ外部キーが2本ある（20260911155718_space_org_fk.sql）ため、
 * 外部キー名を書かない `spaces!inner(...)` は本番で「どちらの道か決められない」エラーになり、
 * この関数はエラーを null に丸めるので「org が見つからない」ように見えていた。
 */

const selectMock = vi.fn()
const maybeSingleMock = vi.fn()

function chain(): Record<string, unknown> {
  const builder: Record<string, unknown> = {}
  builder.select = vi.fn((columns: string) => {
    selectMock(columns)
    return builder
  })
  builder.eq = vi.fn(() => builder)
  builder.maybeSingle = maybeSingleMock
  return builder
}

const fromMock = vi.fn(() => chain())

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({ from: fromMock })),
}))

const store = await import('@/lib/reminders/taskReminderStore')

beforeEach(() => {
  vi.clearAllMocks()
  maybeSingleMock.mockResolvedValue({ data: { space_id: 's-1', spaces: { org_id: 'org-1' } }, error: null })
})

describe('findTaskOrgId', () => {
  it('tasks から spaces を外部キー名（tasks_space_id_fkey）つきで埋め込む', async () => {
    await store.findTaskOrgId('t-1')

    expect(fromMock).toHaveBeenCalledWith('tasks')
    expect(selectMock).toHaveBeenCalledWith('space_id, spaces!tasks_space_id_fkey!inner(org_id)')
  })

  it('埋め込みの結果から orgId と spaceId を返す', async () => {
    await expect(store.findTaskOrgId('t-1')).resolves.toEqual({ orgId: 'org-1', spaceId: 's-1' })
  })

  it('DBエラーのときは null を返す', async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: { message: 'boom' } })
    await expect(store.findTaskOrgId('t-1')).resolves.toBeNull()
  })
})
