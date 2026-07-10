import { describe, it, expect } from 'vitest'
import { parseDigestCompleteCommand } from '@/lib/channels/digest/commands'

/**
 * グループ内「完了N」「N 完了」テキストの解析。
 * マッチしなければ null（通常メッセージとして記録のみ）。
 */

describe('parseDigestCompleteCommand', () => {
  it('「完了N」を解析する', () => {
    expect(parseDigestCompleteCommand('完了2')).toBe(2)
  })

  it('「N 完了」を解析する', () => {
    expect(parseDigestCompleteCommand('2 完了')).toBe(2)
  })

  it('「完了 N」（空白あり）を解析する', () => {
    expect(parseDigestCompleteCommand('完了 3')).toBe(3)
  })

  it('全角数字を解析する', () => {
    expect(parseDigestCompleteCommand('完了２')).toBe(2)
    expect(parseDigestCompleteCommand('３完了')).toBe(3)
  })

  it('前後の空白・全角スペースを許容する', () => {
    expect(parseDigestCompleteCommand('　完了1　')).toBe(1)
  })

  it('マッチしない通常のメッセージは null', () => {
    expect(parseDigestCompleteCommand('了解しました')).toBeNull()
    expect(parseDigestCompleteCommand('完了しました')).toBeNull()
    expect(parseDigestCompleteCommand('今日は完了2件あります')).toBeNull()
    expect(parseDigestCompleteCommand('')).toBeNull()
  })
})
