import { describe, it, expect, vi } from 'vitest'
import { dbErrorHint, hideDbErrorWithHint } from './dbErrorHints.js'

/**
 * DBのエラーコードから、次にできることが分かる短い日本語のヒントを返す
 * （重複・必須項目の不足・つながりの不整合の3種類）。それ以外は中身を隠す。
 */

describe('dbErrorHint', () => {
  it('23505（重複）は次にできることが分かる文言', () => {
    expect(dbErrorHint({ code: '23505' })).toContain('重複')
  })

  it('23502（必須項目の不足）は次にできることが分かる文言', () => {
    expect(dbErrorHint({ code: '23502' })).toContain('必須')
  })

  it('23503（つながりの不整合）は次にできることが分かる文言', () => {
    expect(dbErrorHint({ code: '23503' })).toMatch(/正しくない|見つかりません/)
  })

  it('見覚えのないコードはnull', () => {
    expect(dbErrorHint({ code: '42501' })).toBeNull()
    expect(dbErrorHint({})).toBeNull()
  })
})

describe('hideDbErrorWithHint', () => {
  it('見覚えのあるコード（重複=23505）は ToolUserError(409) でヒントを返す（生の文言は出さない）', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const err = hideDbErrorWithHint({ code: '23505', message: 'duplicate key value violates unique constraint "x"' }, 'ctx', '失敗しました')
    expect(err).toMatchObject({ name: 'ToolUserError', status: 409 })
    expect(err.message).toContain('重複')
    expect(err.message).not.toContain('duplicate key')
    spy.mockRestore()
  })

  it('必須項目の不足（23502）は ToolUserError(400) でヒントを返す', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const err = hideDbErrorWithHint({ code: '23502', message: 'null value in column "x" violates not-null constraint' }, 'ctx', '失敗しました')
    expect(err).toMatchObject({ name: 'ToolUserError', status: 400 })
    expect(err.message).toContain('必須')
    spy.mockRestore()
  })

  it('つながりの不整合（23503）は ToolUserError(400) でヒントを返す', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const err = hideDbErrorWithHint({ code: '23503', message: 'insert or update on table "x" violates foreign key constraint' }, 'ctx', '失敗しました')
    expect(err).toMatchObject({ name: 'ToolUserError', status: 400 })
    spy.mockRestore()
  })

  it('見覚えのないコードは決まった一般のメッセージ（ToolUserErrorにしない）', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const err = hideDbErrorWithHint({ code: '42501', message: 'permission denied' }, 'ctx', '失敗しました')
    expect(err.message).toBe('失敗しました')
    expect(err).not.toMatchObject({ name: 'ToolUserError' })
    spy.mockRestore()
  })
})
