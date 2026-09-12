import { describe, it, expect } from 'vitest'
import { resolveActorName } from '@/app/admin/(panel)/dashboard/page'

/**
 * profiles.display_name はNOT NULLで既定値が空文字のため、「未設定」の判定は
 * `??`（nullish）ではなく `||`（falsy）で行う必要がある。空文字のまま `??` を
 * 使うと、メールを引けていても表示名の欄が空欄になってしまう。
 */
describe('resolveActorName', () => {
  it('表示名があればそれを使う', () => {
    expect(resolveActorName('ユーザーA', 'usera@example.com')).toBe('ユーザーA')
  })

  it('表示名が空文字でも、メールが引けていればメールを使う（display_nameがnullではない場合）', () => {
    expect(resolveActorName('', 'usera@example.com')).toBe('usera@example.com')
  })

  it('表示名がnullでも、メールが引けていればメールを使う', () => {
    expect(resolveActorName(null, 'usera@example.com')).toBe('usera@example.com')
  })

  it('表示名もメールも無ければSystemにする', () => {
    expect(resolveActorName(null, undefined)).toBe('System')
    expect(resolveActorName('', undefined)).toBe('System')
  })
})
