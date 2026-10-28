import { describe, it, expect } from 'vitest'
import { notificationOpenLink } from '@/lib/notifications/openLink'

/**
 * 受信トレイから元の内容（タスク・会議）を開くリンク。
 * 本番の通知は承認依頼・コメント・メンションなど大半が payload.link を持たない（2026-10-28 に本番で確認）。
 * そのときは task_id / meeting_id と通知の org_id・space_id から組み立てる。
 */
const base = { org_id: 'org-1', space_id: 'space-1' }

describe('notificationOpenLink', () => {
  it('自アプリ内の payload.link があればそれを使う', () => {
    expect(notificationOpenLink({ ...base, payload: { link: '/org-1/scheduling', task_id: 't1' } })).toBe('/org-1/scheduling')
  })

  it('link が無く task_id があれば、タスクの詳細を開くリンクを組み立てる', () => {
    expect(notificationOpenLink({ ...base, payload: { task_id: 't1' } })).toBe('/org-1/project/space-1?task=t1')
  })

  it('link が外部サイトなら使わず、task_id から組み立てる', () => {
    expect(notificationOpenLink({ ...base, payload: { link: 'https://evil.example.com', task_id: 't1' } })).toBe(
      '/org-1/project/space-1?task=t1'
    )
  })

  it('task_id が無く meeting_id があれば、会議を開くリンクを組み立てる', () => {
    expect(notificationOpenLink({ ...base, payload: { meeting_id: 'm1' } })).toMatch(/^\/org-1\/project\/space-1\/meetings.*m1/)
  })

  it('どれも無ければ null', () => {
    expect(notificationOpenLink({ ...base, payload: {} })).toBeNull()
    expect(notificationOpenLink({ ...base, payload: { link: 'javascript:alert(1)' } })).toBeNull()
  })
})
