import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  assertWriteApplied,
  StaleWriteError,
  STALE_WRITE_MESSAGE,
} from '../../../packages/mcp-server/src/lib/staleWrite'

const root = join(__dirname, '../../..')
const read = (p: string) => readFileSync(join(root, p), 'utf-8')

describe('assertWriteApplied', () => {
  it('1行でも書けていれば通す', () => {
    expect(() => assertWriteApplied(1, '2026-09-14T00:00:00Z', '見つかりません')).not.toThrow()
    expect(() => assertWriteApplied(1, undefined, '見つかりません')).not.toThrow()
  })

  it('版を渡していて0行なら「別の場所で更新されています」で断る', () => {
    expect(() => assertWriteApplied(0, '2026-09-14T00:00:00Z', '見つかりません')).toThrow(
      StaleWriteError
    )
    expect(() => assertWriteApplied(0, '2026-09-14T00:00:00Z', '見つかりません')).toThrow(
      STALE_WRITE_MESSAGE
    )
  })

  it('版を渡していないのに0行なら「見つかりません」（競合ではない）', () => {
    expect(() => assertWriteApplied(0, undefined, '会議が見つかりません')).toThrow(
      '会議が見つかりません'
    )
    expect(() => assertWriteApplied(0, undefined, '会議が見つかりません')).not.toThrow(
      StaleWriteError
    )
  })
})

/**
 * 任意の引数は、渡す理由が説明文に書かれていないと**誰も渡さない**（AI は説明文しか読まない）。
 * 引数を足しただけで満足しないための検査（並行セッションの指摘）。
 */
describe('渡す理由が、AI と人が読むところ全部に書いてある', () => {
  it('MCP のスキーマ（AI が読む）に書いてある', () => {
    const minutes = read('packages/mcp-server/src/tools/minutes.ts')
    const wiki = read('packages/mcp-server/src/tools/wiki.ts')
    for (const src of [minutes, wiki]) {
      expect(src).toContain('expectedUpdatedAt')
      expect(src).toMatch(/黙って上書き|他の人の更新を上書き|先に書いた内容を黙って上書き/)
    }
  })

  it('コマンド一覧（人と AI が読む）に書いてある', () => {
    const manifest = read('src/lib/cli-manifest.ts')
    expect(manifest).toContain('--expected-updated-at <ts>')
    // minutes と wiki の両方に付いている
    expect(manifest.match(/--expected-updated-at <ts>/g)?.length).toBe(2)
    expect(manifest).toContain('渡さないと他の人の更新を黙って消す')
  })

  it('AI 向けの手引きに「読んでから書く」の手順がある', () => {
    const skill = read('src/lib/cli-skill.ts')
    expect(skill).toContain('先に読んで版を渡す')
    expect(skill).toContain('--expected-updated-at')
    // 断られたときに機械的に上書きさせない
    expect(skill).toContain('自分の書きかけを機械的に上書きしない')
  })

  it('末尾に足すだけの append には付けない（衝突しないので往復が増えるだけ）', () => {
    const minutes = read('packages/mcp-server/src/tools/minutes.ts')
    const appendSchema = minutes.slice(
      minutes.indexOf('const minutesAppendSchema'),
      minutes.indexOf('const minutesAppendSchema') + 400
    )
    expect(appendSchema).not.toContain('expectedUpdatedAt')
  })

  it('minutes_get が版を返す（返さないと渡しようがない）', () => {
    const minutes = read('packages/mcp-server/src/tools/minutes.ts')
    expect(minutes).toContain('updated_at: meeting.updated_at')
  })
})
