import { describe, it, expect, vi } from 'vitest'
import { castDocVote, createDocPoll, fetchDocPolls } from '@/lib/doc-polls/api'

function fakeSupabase(result: { data?: unknown; error?: unknown }) {
  const calls: Array<{ fn: string; args: unknown[] }> = []
  const builder: Record<string, unknown> = {}
  for (const fn of ['select', 'eq', 'order']) {
    builder[fn] = (...args: unknown[]) => {
      calls.push({ fn, args })
      return builder
    }
  }
  builder.then = (resolve: (v: unknown) => void) => resolve(result)
  const client = {
    from: vi.fn((table: string) => {
      calls.push({ fn: 'from', args: [table] })
      return builder
    }),
    rpc: vi.fn(async (name: string, args: unknown) => {
      calls.push({ fn: 'rpc', args: [name, args] })
      return result
    }),
  }
  return { client, calls }
}

describe('fetchDocPolls', () => {
  it('その Wiki ページの投票を、票と履歴ごと1回で読む', async () => {
    const { client, calls } = fakeSupabase({
      data: [
        {
          id: 'p1',
          reason_required: 'none',
          doc_votes: [{ poll_id: 'p1', user_id: 'u1', choice: 'ok', memo: '', created_at: 't', updated_at: 't' }],
          doc_vote_events: [{ id: 1, poll_id: 'p1', user_id: 'u1', action: 'cast', choice: 'ok', memo: '', created_at: 't' }],
        },
      ],
      error: null,
    })
    const got = await fetchDocPolls(client as never, { wikiPageId: 'w1' })
    expect(calls.find((c) => c.fn === 'from')?.args).toEqual(['doc_polls'])
    expect(calls.find((c) => c.fn === 'eq')?.args).toEqual(['wiki_page_id', 'w1'])
    // 埋め込みは外部キー名を書く（本番で名前の曖昧さで落ちないように）
    const select = String(calls.find((c) => c.fn === 'select')?.args[0])
    expect(select).toContain('doc_votes!doc_votes_poll_id_fkey')
    expect(select).toContain('doc_vote_events!doc_vote_events_poll_id_fkey')
    expect(got.p1.votes).toHaveLength(1)
    expect(got.p1.events).toHaveLength(1)
    expect(got.p1.poll).not.toHaveProperty('doc_votes')
  })

  it('議事録の投票は meeting_id で絞る', async () => {
    const { client, calls } = fakeSupabase({ data: [], error: null })
    await fetchDocPolls(client as never, { meetingId: 'm1' })
    expect(calls.find((c) => c.fn === 'eq')?.args).toEqual(['meeting_id', 'm1'])
  })

  it('読めなかったら投げる', async () => {
    const { client } = fakeSupabase({ data: null, error: { message: 'boom' } })
    await expect(fetchDocPolls(client as never, { wikiPageId: 'w1' })).rejects.toBeTruthy()
  })
})

describe('createDocPoll', () => {
  it('番号・文書・理由必須の設定を渡す', async () => {
    const { client } = fakeSupabase({ data: 'p1', error: null })
    await createDocPoll(client as never, { pollId: 'p1', source: { wikiPageId: 'w1' }, reasonRequired: 'ng_hold' })
    expect(client.rpc).toHaveBeenCalledWith('rpc_doc_poll_create', {
      p_poll_id: 'p1',
      p_wiki_page_id: 'w1',
      p_meeting_id: null,
      p_reason_required: 'ng_hold',
    })
  })
  it('失敗したら DB の返事ごと投げる（番号の横取りを見分けるため）', async () => {
    const { client } = fakeSupabase({ data: null, error: { code: '22023', message: 'poll_id_in_use' } })
    await expect(
      createDocPoll(client as never, { pollId: 'p1', source: { wikiPageId: 'w1' }, reasonRequired: 'none' })
    ).rejects.toMatchObject({ message: 'poll_id_in_use' })
  })
})

describe('castDocVote', () => {
  it('押す', async () => {
    const { client } = fakeSupabase({ data: 'ng', error: null })
    await castDocVote(client as never, { pollId: 'p1', choice: 'ng', memo: '予算' })
    expect(client.rpc).toHaveBeenCalledWith('rpc_doc_vote_cast', { p_poll_id: 'p1', p_choice: 'ng', p_memo: '予算' })
  })
  it('取り消しは choice を null で送る', async () => {
    const { client } = fakeSupabase({ data: null, error: null })
    await castDocVote(client as never, { pollId: 'p1', choice: null, memo: '' })
    expect(client.rpc).toHaveBeenCalledWith('rpc_doc_vote_cast', { p_poll_id: 'p1', p_choice: null, p_memo: '' })
  })
  it('失敗したら投げる', async () => {
    const { client } = fakeSupabase({ data: null, error: { code: '22023', message: 'reason_required' } })
    await expect(castDocVote(client as never, { pollId: 'p1', choice: 'ng', memo: '' })).rejects.toMatchObject({
      message: 'reason_required',
    })
  })
})
