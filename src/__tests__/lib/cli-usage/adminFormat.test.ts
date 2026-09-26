import { describe, it, expect } from 'vitest'
import { formatErrorDetail, sourceLabel } from '@/lib/cli-usage/adminFormat'

/**
 * /admin/cli-usage の「直近のログ」表で使う純粋な整形関数。
 * error_detail(jsonb) を読める文字列にする／source(cli|mcp)を日本語ラベルにする。
 */
describe('formatErrorDetail', () => {
  it('null / undefined は空文字', () => {
    expect(formatErrorDetail(null)).toBe('')
    expect(formatErrorDetail(undefined)).toBe('')
  })

  it('オブジェクトは読める形の JSON 文字列にする', () => {
    const detail = { name: 'Error', message: 'x', cause: { code: '42501', message: 'permission denied' } }
    const out = formatErrorDetail(detail)
    expect(out).toContain('"message": "x"')
    expect(out).toContain('42501')
  })

  it('想定外の値でも例外を投げない', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(() => formatErrorDetail(circular)).not.toThrow()
  })
})

describe('sourceLabel', () => {
  it('cli / mcp を日本語ラベルにする', () => {
    expect(sourceLabel('cli')).toBe('CLI')
    expect(sourceLabel('mcp')).toBe('外部チャット(MCP)')
  })

  it('見覚えのない値はそのまま返す', () => {
    expect(sourceLabel('unknown-source')).toBe('unknown-source')
  })
})
