import { describe, it, expect, vi, afterEach } from 'vitest'

import { accountingFetch } from '@/lib/accounting/http'
import type { ProviderError } from '@/lib/task-sync/types'

const POLICY = { kind: 'fixed', host: 'api.freee.co.jp' } as const

function mockResponse(status: number, body = '', headers: Record<string, string> = {}) {
  return new Response(body, { status, headers })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

async function callAndCatch(status: number, body = ''): Promise<ProviderError> {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(mockResponse(status, body))))
  try {
    await accountingFetch(POLICY, 'freee', 'tok', 'https://api.freee.co.jp/iv/quotations', {
      method: 'POST',
      body: {},
    })
    throw new Error('例外が投げられませんでした')
  } catch (err) {
    return err as ProviderError
  }
}

describe('accountingFetch — 失敗の分類', () => {
  it('403（権限不足）は恒久失敗として扱う', async () => {
    // 会計サービスの権限は契約プランと連携アプリの設定で決まり、待っても付与されない。
    // 一時失敗にすると通らないリクエストを投げ続け、利用者には「一時的に接続できません」と
    // 出てしまい、本当の原因（権限不足）に辿り着けない。
    const err = await callAndCatch(403, '{"message":"forbidden"}')

    expect(err.status).toBe(403)
    expect(err.permanent).toBe(true)
    expect(err.message).toContain('権限がありません')
    expect(err.message).toContain('プラン')
  })

  it('400 / 404 / 422 も恒久失敗', async () => {
    for (const status of [400, 404, 422]) {
      const err = await callAndCatch(status)
      expect(err.permanent).toBe(true)
    }
  })

  it('500 は一時失敗（再試行に回す）', async () => {
    const err = await callAndCatch(500)
    expect(err.permanent).toBeFalsy()
    expect(err.status).toBe(500)
  })

  it('429 は Retry-After を待ち時間として運ぶ', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(mockResponse(429, '', { 'retry-after': '30' }))))
    try {
      await accountingFetch(POLICY, 'freee', 'tok', 'https://api.freee.co.jp/iv/invoices', { method: 'GET' })
      throw new Error('例外が投げられませんでした')
    } catch (err) {
      expect((err as ProviderError).retryAfterMs).toBe(30_000)
      expect((err as ProviderError).permanent).toBeFalsy()
    }
  })

  it('宣言と違うホストへは投げない（送信先の間違いは鍵の漏洩になる）', async () => {
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)

    await expect(
      accountingFetch(POLICY, 'freee', 'tok', 'https://evil.example.com/iv/invoices', { method: 'GET' }),
    ).rejects.toThrow()

    expect(spy).not.toHaveBeenCalled()
  })
})
