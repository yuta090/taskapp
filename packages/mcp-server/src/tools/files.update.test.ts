import { describe, it, expect, vi, beforeEach } from 'vitest'

/** file_update: 説明文を書く／消す（null・空白だけ）／表示名のパス区切り拒否／指定なしはエラー。 */
const updates: Record<string, unknown>[] = []
const chain: Record<string, unknown> = {}
for (const m of ['update', 'eq', 'select']) {
  chain[m] = (...a: unknown[]) => { if (m === 'update') updates.push(a[0] as Record<string, unknown>); return chain }
}
chain.single = async () => ({ data: { id: 'f-1', name: 'a.csv', description: updates.at(-1)?.description ?? null, mime_type: 'text/csv', size_bytes: 10, origin: 'internal', client_visible: false, status: 'ready', created_at: 'x' }, error: null })

vi.mock('../supabase/client.js', () => ({ getSupabaseClient: () => ({ from: () => chain }) }))
vi.mock('../auth/helpers.js', () => ({ checkAuth: async () => ({ ctx: { userId: 'u1' }, role: 'admin' }) }))

const { fileUpdate } = await import('./files.js')
const S = '00000000-0000-0000-0000-000000000010', F = '00000000-0000-0000-0000-00000000f001'
beforeEach(() => { updates.length = 0 })

describe('file_update', () => {
  it('説明文を書く（前後の空白は落とし、戻り値にも入る）', async () => {
    const r = await fileUpdate({ spaceId: S, fileId: F, description: '  顧客管理表 v1  ' })
    expect(updates[0]).toEqual({ description: '顧客管理表 v1' })
    expect(r.description).toBe('顧客管理表 v1')
  })
  it('null または空白だけなら説明を消す（null）', async () => {
    await fileUpdate({ spaceId: S, fileId: F, description: null })
    await fileUpdate({ spaceId: S, fileId: F, description: '   ' })
    expect(updates).toEqual([{ description: null }, { description: null }])
  })
  it('name にパス区切りは使えない・何も指定しなければエラー', async () => {
    await expect(fileUpdate({ spaceId: S, fileId: F, name: '../x.csv' })).rejects.toThrow(/パス区切り/)
    await expect(fileUpdate({ spaceId: S, fileId: F })).rejects.toThrow(/更新するフィールド/)
  })
})
