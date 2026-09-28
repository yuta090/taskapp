import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * logToolUsage — /api/tools と /api/mcp が共有する利用記録(fire-and-forget)。
 * 失敗時は error_message（呼んだ人に返した決まった文言）に加え、原因の詳細を
 * error_detail に残す（運営画面 /admin/cli-usage 専用。呼んだ人には返さない）。
 */

const insertedRows: Record<string, unknown>[] = []
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        insertedRows.push(row)
        return Promise.resolve({ error: null })
      },
    }),
  }),
}))

const { logToolUsage } = await import('@/lib/cli-usage/logToolUsage')

const INFO = { keyId: 'key-1', orgId: 'org-1', userId: 'user-1', spaceId: 'space-1' }

beforeEach(() => {
  insertedRows.length = 0
})

describe('logToolUsage', () => {
  it('info が無ければ何も書かない（認証前に失敗した等）', () => {
    logToolUsage({ toolName: 't', status: 'error', responseMs: 1, info: null, source: 'cli', error: new Error('x') })
    expect(insertedRows).toHaveLength(0)
  })

  it('成功時は error_message / error_detail を null にして source を書く', () => {
    logToolUsage({ toolName: 'task_list', status: 'success', responseMs: 12, info: INFO, source: 'cli' })

    expect(insertedRows).toHaveLength(1)
    expect(insertedRows[0]).toMatchObject({
      api_key_id: 'key-1',
      org_id: 'org-1',
      user_id: 'user-1',
      space_id: 'space-1',
      tool_name: 'task_list',
      status: 'success',
      error_message: null,
      error_detail: null,
      source: 'cli',
    })
  })

  it('失敗時は error_message に文言、error_detail に原因の詳細を残す', () => {
    const dbError = { code: '42501', message: 'permission denied for table x' }
    const err = new Error('アクティビティログの検索に失敗しました', { cause: dbError })

    logToolUsage({ toolName: 'activity_search', status: 'error', responseMs: 5, info: INFO, source: 'mcp', error: err })

    expect(insertedRows).toHaveLength(1)
    const row = insertedRows[0]
    expect(row.error_message).toBe('アクティビティログの検索に失敗しました')
    expect(row.source).toBe('mcp')
    expect(row.error_detail).toMatchObject({
      name: 'Error',
      message: 'アクティビティログの検索に失敗しました',
      cause: { code: '42501', message: 'permission denied for table x' },
    })
  })

  it('dev-key は api_key_id を null にする', () => {
    logToolUsage({
      toolName: 't',
      status: 'success',
      responseMs: 1,
      info: { ...INFO, keyId: 'dev-key' },
      source: 'cli',
    })

    expect(insertedRows[0].api_key_id).toBeNull()
  })

  it('ToolUserError には stack を含めない', () => {
    class ToolUserError extends Error {
      status = 409
      constructor(message: string) {
        super(message)
        this.name = 'ToolUserError'
      }
    }
    const err = new ToolUserError('レビューの承認が済んでいないため、完了にできません')

    logToolUsage({ toolName: 'task_update', status: 'error', responseMs: 1, info: INFO, source: 'cli', error: err })

    const detail = insertedRows[0].error_detail as Record<string, unknown>
    expect(detail.stack).toBeUndefined()
  })

  it('想定外のエラー（ToolUserError以外）には stack を含める', () => {
    const err = new Error('unexpected internal failure')

    logToolUsage({ toolName: 'task_list', status: 'error', responseMs: 1, info: INFO, source: 'cli', error: err })

    const detail = insertedRows[0].error_detail as Record<string, unknown>
    expect(typeof detail.stack).toBe('string')
  })
})
