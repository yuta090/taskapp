import { describe, expect, it } from 'vitest'
import {
  approvalStateLabel,
  canCancelReview,
  isSpaceAdminMember,
  memberDisplayName,
  normalizeReviewRow,
  optimisticOpenedReview,
  reviewRequestMode,
  resolveSelection,
  reviewStatusLabel,
  selectableReviewers,
  toggleReviewer,
  toReviewMembers,
  type ReviewMember,
  type TaskReviewData,
} from './reviewers'

const members: ReviewMember[] = [
  { id: 'me', displayName: '自分', role: 'admin' },
  { id: 'a', displayName: '佐藤', role: 'editor' },
  { id: 'b', displayName: '鈴木', role: 'admin' },
  { id: 'v', displayName: '閲覧者', role: 'viewer' },
  { id: 'c', displayName: '相手先', role: 'client' },
  { id: 'w', displayName: '協力会社', role: 'vendor' },
]

describe('selectableReviewers', () => {
  it('自分と、admin / editor 以外（viewer・client・vendor）を除く', () => {
    expect(selectableReviewers(members, 'me').map((m) => m.id)).toEqual(['a', 'b'])
  })
  it('自分が分からなくても admin / editor だけを返す', () => {
    expect(selectableReviewers(members, null).map((m) => m.id)).toEqual(['me', 'a', 'b'])
  })
  it('メンバーが空なら空', () => {
    expect(selectableReviewers([], 'me')).toEqual([])
  })
})

describe('isSpaceAdminMember', () => {
  it('自分の役割が admin のときだけ true（Web と同じ。owner は含めない）', () => {
    expect(isSpaceAdminMember(members, 'me')).toBe(true)
    expect(isSpaceAdminMember(members, 'a')).toBe(false)
    expect(isSpaceAdminMember(members, 'nobody')).toBe(false)
    expect(isSpaceAdminMember(members, null)).toBe(false)
  })
})

describe('memberDisplayName', () => {
  it('メンバーにいれば名前、いなければ id の先頭8文字', () => {
    expect(memberDisplayName(members, 'a')).toBe('佐藤')
    expect(memberDisplayName(members, '12345678-aaaa-bbbb')).toBe('12345678')
  })
})

describe('ラベル', () => {
  it('依頼の状況', () => {
    expect(reviewStatusLabel('approved')).toBe('社内承認済み')
    expect(reviewStatusLabel('changes_requested')).toBe('差し戻し')
    expect(reviewStatusLabel('open')).toBe('社内承認待ち')
  })
  it('承認者ごとの状態', () => {
    expect(approvalStateLabel('approved')).toBe('承認')
    expect(approvalStateLabel('blocked')).toBe('差し戻し')
    expect(approvalStateLabel('pending')).toBe('未対応')
    expect(approvalStateLabel('unknown')).toBe('未対応')
  })
})

describe('reviewRequestMode', () => {
  it('依頼が無い・取り消し済みなら「依頼」', () => {
    expect(reviewRequestMode(null)).toBe('request')
    expect(reviewRequestMode({ status: 'cancelled' })).toBe('request')
  })
  it('承認済み・差し戻しなら「再依頼」', () => {
    expect(reviewRequestMode({ status: 'approved' })).toBe('rerequest')
    expect(reviewRequestMode({ status: 'changes_requested' })).toBe('rerequest')
  })
  it('承認待ち（open）は依頼できない', () => {
    expect(reviewRequestMode({ status: 'open' })).toBeNull()
  })
})

describe('canCancelReview', () => {
  const open = { status: 'open', created_by: 'me' }
  it('依頼者本人は取り消せる', () => {
    expect(canCancelReview(open, 'me', false)).toBe(true)
  })
  it('space の admin は他人の依頼も取り消せる', () => {
    expect(canCancelReview(open, 'other', true)).toBe(true)
  })
  it('依頼者でも admin でもなければ取り消せない', () => {
    expect(canCancelReview(open, 'other', false)).toBe(false)
  })
  it('差し戻し中も取り消せる', () => {
    expect(canCancelReview({ status: 'changes_requested', created_by: 'me' }, 'me', false)).toBe(true)
  })
  it('承認済み・取り消し済み・依頼なしは取り消せない', () => {
    expect(canCancelReview({ status: 'approved', created_by: 'me' }, 'me', true)).toBe(false)
    expect(canCancelReview({ status: 'cancelled', created_by: 'me' }, 'me', true)).toBe(false)
    expect(canCancelReview(null, 'me', true)).toBe(false)
  })
  it('自分が分からなければ、依頼者としては扱わない', () => {
    expect(canCancelReview(open, null, false)).toBe(false)
  })
})

describe('resolveSelection', () => {
  it('触っていない（null）あいだは既定の承認者を、選べる人だけに絞って返す', () => {
    expect(resolveSelection(null, ['a', 'gone'], ['a', 'b'])).toEqual(['a'])
  })
  it('選んだあとは、その選択を選べる人と突き合わせる（再依頼で前回の承認者が抜けていても落とす）', () => {
    expect(resolveSelection(['b', 'gone'], ['a'], ['a', 'b'])).toEqual(['b'])
  })
  it('空を選んだら既定には戻らず空のまま', () => {
    expect(resolveSelection([], ['a'], ['a', 'b'])).toEqual([])
  })
})

describe('toggleReviewer', () => {
  it('入っていれば外し、無ければ足す。元の配列は変えない', () => {
    const base = ['a']
    expect(toggleReviewer(base, 'b')).toEqual(['a', 'b'])
    expect(toggleReviewer(base, 'a')).toEqual([])
    expect(base).toEqual(['a'])
  })
})

describe('normalizeReviewRow', () => {
  it('review_approvals を承認者の配列に分ける', () => {
    const row = {
      id: 'r1',
      status: 'open',
      created_by: 'me',
      task_id: 't1',
      review_approvals: [{ id: 'x1', reviewer_id: 'a', state: 'pending', blocked_reason: null, extra: 1 }],
    }
    expect(normalizeReviewRow(row)).toEqual({
      review: { id: 'r1', status: 'open', created_by: 'me' },
      approvals: [{ id: 'x1', reviewer_id: 'a', state: 'pending', blocked_reason: null }],
    })
  })
  it('review_approvals が無い・配列でないときは空にする', () => {
    expect(normalizeReviewRow({ id: 'r1', status: 'approved', created_by: 'me' }).approvals).toEqual([])
  })
})

describe('toReviewMembers', () => {
  it('RPC の行を画面用にし、名前が無ければ id の先頭8文字を使う', () => {
    expect(
      toReviewMembers([
        { user_id: 'u1', display_name: '佐藤', role: 'editor' },
        { user_id: '12345678-aaaa', display_name: null, role: 'admin' },
      ])
    ).toEqual([
      { id: 'u1', displayName: '佐藤', role: 'editor' },
      { id: '12345678-aaaa', displayName: '12345678...', role: 'admin' },
    ])
  })
  it('null なら空', () => {
    expect(toReviewMembers(null)).toEqual([])
  })
})

describe('optimisticOpenedReview', () => {
  const prev = (status: string, approvals: [string, string][]): TaskReviewData => ({
    review: { id: 'r1', status, created_by: 'me' },
    approvals: approvals.map(([reviewer_id, state]) => ({ id: `a-${reviewer_id}`, reviewer_id, state, blocked_reason: state === 'blocked' ? '直して' : null })),
  })

  it('はじめての依頼は、全員が未対応の承認待ち', () => {
    const r = optimisticOpenedReview(null, ['a', 'b'], 'me')
    expect(r.review).toEqual({ id: '', status: 'open', created_by: 'me' })
    expect(r.approvals.map((a) => a.state)).toEqual(['pending', 'pending'])
  })

  it('再依頼では、承認済みの人はそのまま、差し戻した人は未対応に戻る', () => {
    const r = optimisticOpenedReview(prev('changes_requested', [['a', 'approved'], ['b', 'blocked']]), ['a', 'b'], 'me')
    expect(r.approvals.map((a) => [a.reviewer_id, a.state, a.blocked_reason])).toEqual([
      ['a', 'approved', null],
      ['b', 'pending', null],
    ])
    expect(r.review.status).toBe('open')
  })

  it('全員が承認済みなら、最初から approved', () => {
    const r = optimisticOpenedReview(prev('changes_requested', [['a', 'approved']]), ['a'], 'me')
    expect(r.review.status).toBe('approved')
  })

  it('取り消し済みの前回の状態は引き継がない', () => {
    const r = optimisticOpenedReview(prev('cancelled', [['a', 'approved']]), ['a'], 'me')
    expect(r.approvals[0].state).toBe('pending')
  })
})
