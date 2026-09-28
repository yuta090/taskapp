import { describe, it, expect } from 'vitest'
import {
  DOC_POLL_TYPE,
  collectPollBlocks,
  findPollBlocksToRenumber,
  groupVotesByChoice,
  historyOf,
  needsReason,
  voteErrorMessage,
  applyOptimisticVote,
  planPollSync,
  pollOwnersOf,
} from '@/lib/doc-polls/logic'
import type { DocVote, DocVoteEvent } from '@/lib/doc-polls/types'

const vote = (user_id: string, choice: DocVote['choice'], updated_at: string, memo = ''): DocVote => ({
  poll_id: 'p1',
  user_id,
  choice,
  memo,
  created_at: updated_at,
  updated_at,
})

describe('needsReason（理由を書かないと押せないか）', () => {
  it('理由必須の投票では NG と保留に理由が要る', () => {
    expect(needsReason('ng_hold', 'ng', '')).toBe(true)
    expect(needsReason('ng_hold', 'hold', '')).toBe(true)
  })
  it('OK は理由必須の投票でも要らない', () => {
    expect(needsReason('ng_hold', 'ok', '')).toBe(false)
  })
  it('空白・改行・全角空白だけは書いていないとみなす（サーバーと同じ）', () => {
    expect(needsReason('ng_hold', 'ng', ' \n\t　')).toBe(true)
    expect(needsReason('ng_hold', 'ng', '予算')).toBe(false)
  })
  it('理由任意の投票では要らない', () => {
    expect(needsReason('none', 'ng', '')).toBe(false)
  })
})

describe('groupVotesByChoice（選んだボタンごとに分ける）', () => {
  it('OK / NG / 保留に分け、押した順に並べる', () => {
    const g = groupVotesByChoice([
      vote('b', 'ok', '2026-09-26T10:02:00Z'),
      vote('a', 'ok', '2026-09-26T10:01:00Z'),
      vote('c', 'hold', '2026-09-26T10:03:00Z'),
    ])
    expect(g.ok.map((v) => v.user_id)).toEqual(['a', 'b'])
    expect(g.ng).toEqual([])
    expect(g.hold.map((v) => v.user_id)).toEqual(['c'])
  })
})

describe('historyOf（その人の履歴）', () => {
  const ev = (id: number, user_id: string, action: DocVoteEvent['action'], choice: DocVoteEvent['choice']): DocVoteEvent => ({
    id,
    poll_id: 'p1',
    user_id,
    action,
    choice,
    memo: '',
    created_at: `2026-09-26T10:0${id}:00Z`,
  })
  const events = [ev(1, 'a', 'cast', 'ok'), ev(2, 'b', 'cast', 'ng'), ev(3, 'a', 'change', 'hold')]

  it('その人の分だけを古い順に返す', () => {
    expect(historyOf(events, 'a').map((e) => e.id)).toEqual([1, 3])
  })
  it('1回しか押していない人は「変更あり」にしない（履歴が2件以上のときだけ）', () => {
    expect(historyOf(events, 'b')).toHaveLength(1)
  })
})

describe('voteErrorMessage（押せなかった理由を画面の言葉にする）', () => {
  it('理由必須', () => {
    expect(voteErrorMessage({ code: '22023', message: 'reason_required' })).toBe('NG と保留は理由を書いてください')
  })
  it('権限なし', () => {
    expect(voteErrorMessage({ code: '42501', message: 'forbidden' })).toBe('この投票には押せません')
  })
  it('メモが長すぎる', () => {
    expect(voteErrorMessage({ code: '22023', message: 'memo_too_long' })).toBe('メモは2000字までです')
  })
  it('それ以外', () => {
    expect(voteErrorMessage(new Error('fetch failed'))).toBe('送れませんでした。もう一度押してください')
  })
})

type Blk = { id: string; type: string; props?: Record<string, unknown>; children?: Blk[] }
const poll = (id: string, pollId: string, children: Blk[] = []): Blk => ({
  id,
  type: DOC_POLL_TYPE,
  props: { pollId, reasonRequired: 'none' },
  children,
})

describe('collectPollBlocks（本文の投票ブロックを拾う）', () => {
  it('字下げした子の中まで拾う', () => {
    const doc: Blk[] = [
      { id: 'x', type: 'paragraph', children: [poll('b2', 'p2')] },
      poll('b1', 'p1'),
    ]
    expect(collectPollBlocks(doc).map((b) => b.id)).toEqual(['b2', 'b1'])
  })
})

describe('findPollBlocksToRenumber（番号を振り直すブロック）', () => {
  it('同じ番号が2つあれば、後ろのほうを振り直す（コピーして貼ったもの）', () => {
    const doc: Blk[] = [poll('b1', 'p1'), poll('b2', 'p1')]
    expect(findPollBlocksToRenumber(doc).map((b) => b.id)).toEqual(['b2'])
  })
  it('番号が空のブロックも振り直す', () => {
    expect(findPollBlocksToRenumber([poll('b1', '')]).map((b) => b.id)).toEqual(['b1'])
  })
  it('重なりが無ければ何もしない', () => {
    expect(findPollBlocksToRenumber([poll('b1', 'p1'), poll('b2', 'p2')])).toEqual([])
  })
})

describe('applyOptimisticVote（押した直後に画面だけ先に変える）', () => {
  const base = {
    p1: {
      poll: {
        id: 'p1', org_id: 'o', space_id: 's', wiki_page_id: 'w', meeting_id: null,
        reason_required: 'none' as const, created_by: 'u', created_at: 't',
      },
      votes: [vote('a', 'ok', '2026-09-26T10:00:00Z')],
      events: [],
    },
  }
  const now = '2026-09-26T11:00:00Z'

  it('初めて押した人は票が増える', () => {
    const next = applyOptimisticVote(base, { pollId: 'p1', userId: 'b', choice: 'ng', memo: 'x' }, now)
    expect(next.p1.votes.map((v) => `${v.user_id}:${v.choice}:${v.memo}`)).toEqual(['a:ok:', 'b:ng:x'])
  })
  it('押し直した人は票が置き換わる（1人1票）', () => {
    const next = applyOptimisticVote(base, { pollId: 'p1', userId: 'a', choice: 'hold', memo: '' }, now)
    expect(next.p1.votes).toHaveLength(1)
    expect(next.p1.votes[0].choice).toBe('hold')
    expect(next.p1.votes[0].updated_at).toBe(now)
  })
  it('取り消すと票が消える', () => {
    const next = applyOptimisticVote(base, { pollId: 'p1', userId: 'a', choice: null, memo: '' }, now)
    expect(next.p1.votes).toEqual([])
  })
  it('元のデータは書き換えない', () => {
    applyOptimisticVote(base, { pollId: 'p1', userId: 'a', choice: null, memo: '' }, now)
    expect(base.p1.votes).toHaveLength(1)
  })
  it('知らない投票なら何もしない', () => {
    expect(applyOptimisticVote(base, { pollId: 'zz', userId: 'a', choice: 'ok', memo: '' }, now)).toBe(base)
  })
})

describe('planPollSync（開いている人の画面が、何を振り直して何を作るか）', () => {
  const withReason = (b: Blk, r: string): Blk => ({ ...b, props: { ...b.props, reasonRequired: r } })

  it('DB に無い番号は作る（置いた直後・作り損ねたもの）。理由必須の設定も渡す', () => {
    const plan = planPollSync([withReason(poll('b1', 'p1'), 'ng_hold'), poll('b2', 'p2')], { p2: true }, new Set())
    expect(plan.create).toEqual([{ pollId: 'p1', reasonRequired: 'ng_hold' }])
    expect(plan.renumber).toEqual([])
  })
  it('作っている最中・作れなかった番号は飛ばす（何度も作りに行かない）', () => {
    const plan = planPollSync([poll('b1', 'p1')], {}, new Set(['p1']))
    expect(plan.create).toEqual([])
  })
  it('重なった番号は振り直しに回し、作る側には入れない', () => {
    const plan = planPollSync([poll('b1', 'p1'), poll('b2', 'p1')], { p1: true }, new Set())
    expect(plan.renumber.map((b) => b.id)).toEqual(['b2'])
    expect(plan.create).toEqual([])
  })
  it('知らない設定の値は理由任意として扱う', () => {
    const plan = planPollSync([withReason(poll('b1', 'p1'), 'weird')], {}, new Set())
    expect(plan.create).toEqual([{ pollId: 'p1', reasonRequired: 'none' }])
  })
})

describe('findPollBlocksToRenumber と前の持ち主', () => {
  it('元の投票の上に貼っても、前からあったブロックが番号（＝票）を持ち続ける', () => {
    // 前は b1 が p1 を持っていた。貼った b9 が上に来た
    const doc: Blk[] = [poll('b9', 'p1'), poll('b1', 'p1')]
    expect(findPollBlocksToRenumber(doc, { p1: 'b1' }).map((b) => b.id)).toEqual(['b9'])
  })
  it('前の持ち主が分からなければ、上のブロックが持つ', () => {
    const doc: Blk[] = [poll('b9', 'p1'), poll('b1', 'p1')]
    expect(findPollBlocksToRenumber(doc, {}).map((b) => b.id)).toEqual(['b1'])
  })
  it('pollOwnersOf は番号ごとに持ち主のブロックを返す', () => {
    expect(pollOwnersOf([poll('b1', 'p1'), poll('b2', 'p2'), poll('b3', 'p1')])).toEqual({ p1: 'b1', p2: 'b2' })
  })
})
