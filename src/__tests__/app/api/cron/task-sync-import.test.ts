import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * POST /api/cron/task-sync-import — タスク同期の定期取り込みを起動する内部API。
 *
 * cron ルートで固定したいのは認証境界だけ（取り込みの中身は runner/engine のテストが持つ）。
 * ここが素通しだと、外部から取り込みを任意に起動されて外部APIのレート制限を消費させられる。
 */

const runTaskSyncImport = vi.fn()
vi.mock('@/lib/task-sync/runner', () => ({
  runTaskSyncImport: () => runTaskSyncImport(),
}))

const { POST } = await import('@/app/api/cron/task-sync-import/route')

function req(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/cron/task-sync-import', { method: 'POST', headers })
}

const SUMMARY = { connections: 1, created: 2, updated: 0, completed: 0, orphaned: 0, skipped: 0, reasons: [] }

beforeEach(() => {
  runTaskSyncImport.mockReset().mockResolvedValue(SUMMARY)
  process.env.CRON_SECRET = 'cron-secret'
})

afterEach(() => {
  delete process.env.CRON_SECRET
})

describe('認証境界', () => {
  it('正しい cron secret なら取り込みを実行し結果を返す', async () => {
    const res = await POST(req({ authorization: 'Bearer cron-secret' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(SUMMARY)
    expect(runTaskSyncImport).toHaveBeenCalledTimes(1)
  })

  it('Authorization が無ければ 401（取り込みは走らせない）', async () => {
    const res = await POST(req())
    expect(res.status).toBe(401)
    expect(runTaskSyncImport).not.toHaveBeenCalled()
  })

  it('secret が違えば 401', async () => {
    const res = await POST(req({ authorization: 'Bearer wrong' }))
    expect(res.status).toBe(401)
    expect(runTaskSyncImport).not.toHaveBeenCalled()
  })

  it('CRON_SECRET 未設定なら 500（設定漏れを素通しして誰でも叩ける状態にしない）', async () => {
    delete process.env.CRON_SECRET
    const res = await POST(req({ authorization: 'Bearer anything' }))
    expect(res.status).toBe(500)
    expect(runTaskSyncImport).not.toHaveBeenCalled()
  })
})
