import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { callTool, setApiConfig } from './api-client.js'

/**
 * サーバーが断ったときに CLI が出すメッセージ。
 * 入力チェックのエラーは { error: 'Validation error', details: [{ path, message }] } で返るが、
 * error を優先して details を捨てていたため「Validation error」としか出ず、
 * どの項目が悪いのか分からなかった（2026-09-12）。
 */
function respond(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })),
  )
}

beforeEach(() => setApiConfig('https://example.test', 'tsk_test_key_123'))
afterEach(() => vi.unstubAllGlobals())

describe('callTool のエラー表示', () => {
  it('入力チェックの details を、どの項目が何で断られたか分かる形で添える', async () => {
    respond(400, {
      error: 'Validation error',
      details: [
        { path: ['heldAt'], message: 'Invalid datetime' },
        { path: ['title'], message: 'Required' },
      ],
    })

    await expect(callTool('meeting_create', {})).rejects.toThrow(
      'Validation error: heldAt: Invalid datetime / title: Required',
    )
  })

  it('理由の文言だけのときは、そのまま出す', async () => {
    respond(409, { error: 'レビューの承認が済んでいないため、完了にできません' })

    await expect(callTool('task_update', {})).rejects.toThrow(/^レビューの承認が済んでいないため、完了にできません$/)
  })

  it('details が文字列でも添える', async () => {
    respond(400, { error: 'Bad request', details: 'spaceId is missing' })

    await expect(callTool('task_list', {})).rejects.toThrow('Bad request: spaceId is missing')
  })

  it('本文が JSON でなければ HTTP ステータスを出す', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>bad gateway</html>', { status: 502 })))

    await expect(callTool('task_list', {})).rejects.toThrow('HTTP 502')
  })
})
