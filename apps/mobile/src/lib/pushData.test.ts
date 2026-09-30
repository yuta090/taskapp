import { describe, expect, it } from 'vitest'
import { resolveEasProjectId, taskIdFromPushData } from './pushData'

describe('taskIdFromPushData', () => {
  it('サーバー（sendExpoPush）が載せた taskId を取り出す', () => {
    expect(taskIdFromPushData({ notificationId: 'n1', taskId: '0b8f4c1e-1111-4222-8333-444455556666', type: 'ball_passed' })).toBe(
      '0b8f4c1e-1111-4222-8333-444455556666'
    )
  })
  it('タスクに結びつかない通知・形の違うものは null（受信トレイを開く）', () => {
    expect(taskIdFromPushData({ taskId: null })).toBeNull()
    expect(taskIdFromPushData({ taskId: 42 })).toBeNull()
    expect(taskIdFromPushData(undefined)).toBeNull()
    expect(taskIdFromPushData('x')).toBeNull()
  })
  it('UUID の形でないものは使わない（画面のパスに入れるため）', () => {
    expect(taskIdFromPushData({ taskId: '../settings' })).toBeNull()
  })
})

describe('resolveEasProjectId', () => {
  it('EAS の設定から projectId を読む', () => {
    expect(resolveEasProjectId({ easConfig: { projectId: 'p-1' } })).toBe('p-1')
    expect(resolveEasProjectId({ expoConfig: { extra: { eas: { projectId: 'p-2' } } } })).toBe('p-2')
  })
  it('まだ EAS につないでいなければ null（通知の登録を飛ばす）', () => {
    expect(resolveEasProjectId({})).toBeNull()
    expect(resolveEasProjectId({ expoConfig: { extra: {} } })).toBeNull()
  })
})
