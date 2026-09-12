import { describe, it, expect, vi } from 'vitest'
import { notFoundOr, hideDbError } from './dbErrors.js'

/**
 * DBの理由をそのまま呼んだ人に見せない共通の道具。
 * PGRST116（0件）は「見つからない」旨のToolUserError(404)、それ以外は
 * サーバーの記録にだけ残し、一般のエラーのまま返す。
 */

describe('notFoundOr', () => {
  it('PGRST116なら ToolUserError(404)', () => {
    const err = notFoundOr({ code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' }, 'x', '見つかりません', '失敗しました')
    expect(err).toMatchObject({ name: 'ToolUserError', status: 404 })
    expect(err.message).toBe('見つかりません')
  })

  it('それ以外は生の文言を出さない一般のエラー', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const err = notFoundOr({ code: '42501', message: 'permission denied' }, 'x', '見つかりません', '失敗しました')
    expect(err).not.toMatchObject({ name: 'ToolUserError' })
    expect(err.message).toBe('失敗しました')
    expect(err.message).not.toContain('permission denied')
    spy.mockRestore()
  })
})

describe('hideDbError', () => {
  it('生の文言を出さない一般のエラーを返す', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const err = hideDbError({ code: '42501', message: 'permission denied' }, 'x', '失敗しました')
    expect(err).not.toMatchObject({ name: 'ToolUserError' })
    expect(err.message).toBe('失敗しました')
    spy.mockRestore()
  })
})
