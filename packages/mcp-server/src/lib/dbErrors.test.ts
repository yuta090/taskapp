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

  // 呼んだ人には返らないが、利用記録(cli_usage_logs.error_detail・運営画面専用)で原因を追えるように、
  // 元のDBエラーを cause として持たせる（2026-09-26）
  it('元のDBエラーを cause として持たせる（利用記録から原因を追えるように）', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const dbError = { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' }
    const notFound = notFoundOr(dbError, 'x', '見つかりません', '失敗しました')
    expect(notFound.cause).toEqual(dbError)

    const other = { code: '42501', message: 'permission denied' }
    const generic = notFoundOr(other, 'x', '見つかりません', '失敗しました')
    expect(generic.cause).toEqual(other)
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

  it('元のDBエラーを cause として持たせる', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const dbError = { code: '42501', message: 'permission denied' }
    const err = hideDbError(dbError, 'x', '失敗しました')
    expect(err.cause).toEqual(dbError)
    spy.mockRestore()
  })
})
