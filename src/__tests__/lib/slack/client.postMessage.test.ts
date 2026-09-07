import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * postSlackMessage（ツール連携「AgentPM」の通知送信）。
 *
 * 通知本文にはタスクへのリンク(agentpm.app)が入るため、Slack の自動プレビュー展開を
 * 止めないと、毎回サイト紹介カード（タイトル・説明・OG画像）が下にぶら下がる。
 */
const postMessageMock = vi.fn(async () => ({ ok: true, ts: '1.2' }))
vi.mock('@slack/web-api', () => ({
  WebClient: class {
    chat = { postMessage: postMessageMock }
    conversations = { list: vi.fn() }
  },
}))

const singleMock = vi.fn(async () => ({ data: { bot_token_encrypted: 'enc' }, error: null }))
const rpcMock = vi.fn(async () => ({ data: 'xoxb-decrypted', error: null }))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ not: () => ({ single: singleMock }) }) }),
    }),
    rpc: rpcMock,
  }),
}))
vi.mock('@/lib/slack/config', () => ({ SLACK_CONFIG: { clientSecret: 'cs' } }))

const { postSlackMessage } = await import('@/lib/slack/client')

beforeEach(() => {
  postMessageMock.mockClear()
})

describe('postSlackMessage', () => {
  it('リンクのプレビュー展開（unfurl）を止めて投稿する', async () => {
    const r = await postSlackMessage('org-1', 'C1', 'タスクが作成されました', [{ type: 'section' }])
    expect(r).toEqual({ ts: '1.2', ok: true })
    expect(postMessageMock).toHaveBeenCalledTimes(1)
    const arg = (postMessageMock.mock.calls[0] as unknown[])[0] as Record<string, unknown>
    expect(arg).toMatchObject({
      channel: 'C1',
      text: 'タスクが作成されました',
      unfurl_links: false,
      unfurl_media: false,
    })
  })

  it('スレッド返信の thread_ts はそのまま渡す', async () => {
    await postSlackMessage('org-1', 'C1', 't', [], '99.1')
    const arg = (postMessageMock.mock.calls[0] as unknown[])[0] as Record<string, unknown>
    expect(arg.thread_ts).toBe('99.1')
  })
})
