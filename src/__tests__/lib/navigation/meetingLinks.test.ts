import { describe, it, expect } from 'vitest'
import {
  MEETING_QUERY_PARAM,
  PROPOSAL_QUERY_PARAM,
  buildMeetingHref,
  buildProposalHref,
} from '@/lib/navigation/meetingLinks'

/**
 * 回帰: ダッシュボードの会議行リンクは `?meetingId=` を使い、
 * 会議ページの読み取りは `?meeting=` を使っていたため、
 * ダッシュボードから会議を開くとインスペクタが開かない「死にクリック」が発生していた。
 * リンク生成と読み取りが同一のパラメータ名を共有することを保証する。
 */
describe('meeting deep-link params', () => {
  const base = '/org1/project/space1'

  it('会議リンクは読み取り側と同じ meeting パラメータを使う', () => {
    expect(MEETING_QUERY_PARAM).toBe('meeting')
    const href = buildMeetingHref(base, 'm123')
    expect(href).toBe('/org1/project/space1/meetings?meeting=m123')
    // 読み取り側がこのパラメータで復元できること
    const url = new URL(`https://example.com${href}`)
    expect(url.searchParams.get(MEETING_QUERY_PARAM)).toBe('m123')
  })

  it('日程調整リンクは proposal パラメータを使う', () => {
    expect(PROPOSAL_QUERY_PARAM).toBe('proposal')
    const href = buildProposalHref(base, 'p456')
    const url = new URL(`https://example.com${href}`)
    expect(url.searchParams.get(PROPOSAL_QUERY_PARAM)).toBe('p456')
  })
})
