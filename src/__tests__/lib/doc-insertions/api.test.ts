import { describe, it, expect, vi } from 'vitest'
import { createDocInsertion, fetchDocInsertions, markDocInsertionApplied, withdrawDocInsertion } from '@/lib/doc-insertions/api'
import { checkInsertionContent, insertionErrorMessage } from '@/lib/doc-insertions/logic'

function fake(result: { data?: unknown; error?: unknown }) {
  const calls: Array<[string, unknown[]]> = []
  const b: Record<string, unknown> = {}
  for (const fn of ['select', 'eq', 'in', 'order']) b[fn] = (...a: unknown[]) => { calls.push([fn, a]); return b }
  b.then = (r: (v: unknown) => void) => r(result)
  return {
    calls,
    client: { from: vi.fn(() => b), rpc: vi.fn(async () => result) },
  }
}

describe('doc-insertions api', () => {
  it('会議の差し込みを状態で絞って古い順に読む', async () => {
    const { client, calls } = fake({ data: [{ id: 'i1' }], error: null })
    const rows = await fetchDocInsertions(client as never, { meetingId: 'm1' }, ['pending', 'remove_requested'])
    expect(client.from).toHaveBeenCalledWith('doc_insertions')
    expect(calls).toContainEqual(['eq', ['meeting_id', 'm1']])
    expect(calls).toContainEqual(['in', ['status', ['pending', 'remove_requested']]])
    expect(rows).toHaveLength(1)
  })
  it('作る・取り下げる・反映済みにするは DB の関数を呼ぶ', async () => {
    const { client } = fake({ data: 'i9', error: null })
    expect(await createDocInsertion(client as never, { source: { meetingId: 'm1' }, kind: 'paragraph', content: 'x', anchor: null })).toBe('i9')
    expect(client.rpc).toHaveBeenCalledWith('rpc_doc_insertion_create', {
      p_wiki_page_id: null, p_meeting_id: 'm1', p_kind: 'paragraph', p_content: 'x', p_anchor: null,
    })
    await withdrawDocInsertion(client as never, 'i9')
    expect(client.rpc).toHaveBeenCalledWith('rpc_doc_insertion_withdraw', { p_id: 'i9' })
    await markDocInsertionApplied(client as never, 'i9', true)
    expect(client.rpc).toHaveBeenCalledWith('rpc_doc_insertion_mark_applied', { p_id: 'i9', p_anchor_missed: true })
  })
  it('失敗は投げる', async () => {
    const { client } = fake({ data: null, error: { message: 'too_many_pending', code: '22023' } })
    await expect(withdrawDocInsertion(client as never, 'x')).rejects.toMatchObject({ message: 'too_many_pending' })
  })
})

describe('本文の検査（DB と同じ）', () => {
  it('空・長すぎ・制御文字・目印を断る。改行はよい', () => {
    expect(checkInsertionContent(' \n　')).toBe('empty')
    expect(checkInsertionContent('あ'.repeat(2001))).toBe('too_long')
    expect(checkInsertionContent('a\u0007b')).toBe('invalid')
    expect(checkInsertionContent('a<!--task:x-->')).toBe('invalid')
    expect(checkInsertionContent('1行目\n2行目')).toBeNull()
  })
  it('理由を画面の言葉にする', () => {
    expect(insertionErrorMessage({ message: 'too_many_pending' })).toContain('20件')
    expect(insertionErrorMessage({ code: '42501', message: 'forbidden' })).toBe('この文書には書き足せません')
  })
})
