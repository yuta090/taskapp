import { describe, it, expect } from 'vitest'
import {
  readTutorialState,
  isTutorialExpired,
  isNewGroup,
  TUTORIAL_TTL_MS,
  NEW_GROUP_WINDOW_MS,
} from '@/lib/channels/tutorial/state'

/**
 * 練習（対話型チュートリアル）の状態は channel_groups.metadata.tutorial に置く（DDLゼロ）。
 * jsonb は外から来る「なんでも入る箱」なので、読み取りは必ず形を検査してから使う。
 */
describe('readTutorialState', () => {
  it('metadata が無ければ null', () => {
    expect(readTutorialState(null)).toBeNull()
    expect(readTutorialState({})).toBeNull()
  })

  it('tutorial キーの中身をそのまま読む', () => {
    const state = readTutorialState({
      tutorial: {
        step: 'awaiting_done',
        taskId: 'task-1',
        digestNumber: 3,
        startedAt: '2026-07-30T01:00:00.000Z',
      },
    })
    expect(state).toEqual({
      step: 'awaiting_done',
      taskId: 'task-1',
      digestNumber: 3,
      startedAt: '2026-07-30T01:00:00.000Z',
    })
  })

  it('他のキー（teams の serviceUrl 等）が同居していても読める', () => {
    const state = readTutorialState({
      serviceUrl: 'https://smba.example',
      tutorial: { step: 'awaiting_add', startedAt: '2026-07-30T01:00:00.000Z' },
    })
    expect(state?.step).toBe('awaiting_add')
  })

  it('知らない step や壊れた形は null に倒す（練習を始め直せる側に倒す）', () => {
    expect(readTutorialState({ tutorial: 'こわれている' })).toBeNull()
    expect(readTutorialState({ tutorial: { step: 'unknown', startedAt: '2026-07-30T01:00:00.000Z' } })).toBeNull()
    expect(readTutorialState({ tutorial: { step: 'awaiting_add' } })).toBeNull()
  })
})

describe('isTutorialExpired', () => {
  const started = '2026-07-30T00:00:00.000Z'

  it('24時間以内は期限切れではない', () => {
    const now = new Date(Date.parse(started) + TUTORIAL_TTL_MS - 1000)
    expect(isTutorialExpired({ step: 'awaiting_add', startedAt: started }, now)).toBe(false)
  })

  it('24時間を過ぎたら期限切れ（放置の後始末は読んだときに行う＝cronを増やさない）', () => {
    const now = new Date(Date.parse(started) + TUTORIAL_TTL_MS + 1000)
    expect(isTutorialExpired({ step: 'awaiting_add', startedAt: started }, now)).toBe(true)
  })

  it('開始時刻が読めない場合は期限切れ扱い（宙吊りにしない）', () => {
    expect(isTutorialExpired({ step: 'awaiting_add', startedAt: 'こわれている' }, new Date())).toBe(true)
  })
})

describe('isNewGroup', () => {
  const now = new Date('2026-07-30T00:00:00.000Z')

  it('48時間以内に作られたグループは新しい', () => {
    const createdAt = new Date(now.getTime() - NEW_GROUP_WINDOW_MS + 1000).toISOString()
    expect(isNewGroup(createdAt, now)).toBe(true)
  })

  it('48時間より前に作られたグループ（既存グループ）は巻き込まない', () => {
    const createdAt = new Date(now.getTime() - NEW_GROUP_WINDOW_MS - 1000).toISOString()
    expect(isNewGroup(createdAt, now)).toBe(false)
  })

  it('作られた日時が分からなければ新しくないものとして扱う（安全側）', () => {
    expect(isNewGroup(null, now)).toBe(false)
    expect(isNewGroup('こわれている', now)).toBe(false)
  })
})
