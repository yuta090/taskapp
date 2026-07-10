import { describe, it, expect } from 'vitest'
import {
  sanitizeDigestTitle,
  buildDigestExtractionPrompt,
  parseLlmDigestExtraction,
  buildDigestPushText,
  buildDigestFlexMessage,
} from '@/lib/channels/digest/compute'

/**
 * 日次digest抽出・配信の純粋ロジック（DB/LLM呼び出しを含まない）。
 *
 * - サーバ側テンプレート合成のみ: LLM出力からは title 文字列だけを埋め込む（prompt injection対策）
 * - LLM応答はJSON.parseし、失敗したらそのグループはスキップ（例外を投げない）
 * - title はサニタイズ（改行/制御文字除去・50字切り詰め）
 */

describe('sanitizeDigestTitle', () => {
  it('改行・制御文字を除去する', () => {
    expect(sanitizeDigestTitle('金曜までに\n酒屋へ発注\t')).toBe('金曜までに酒屋へ発注')
  })

  it('50字を超える場合は切り詰める', () => {
    const long = 'あ'.repeat(60)
    const result = sanitizeDigestTitle(long)
    expect(result.length).toBe(50)
  })

  it('前後の空白を除去する', () => {
    expect(sanitizeDigestTitle('  発注する  ')).toBe('発注する')
  })
})

describe('buildDigestExtractionPrompt', () => {
  it('メッセージ本文をsource_indexつきで含むプロンプトを生成する', () => {
    const messages = buildDigestExtractionPrompt([
      { index: 0, body: '金曜までに酒屋へ発注お願いします' },
      { index: 1, body: 'ラジャー' },
    ])
    expect(messages.length).toBeGreaterThanOrEqual(1)
    const joined = messages.map((m) => m.content).join('\n')
    expect(joined).toContain('金曜までに酒屋へ発注お願いします')
    expect(joined).toContain('JSON')
  })
})

describe('parseLlmDigestExtraction', () => {
  it('正しいJSON配列を解析する', () => {
    const raw = JSON.stringify([
      { title: '酒屋へ発注', assignee_hint: '田中さん', source_index: 0 },
      { title: '在庫を確認', source_index: 1 },
    ])
    const result = parseLlmDigestExtraction(raw)
    expect(result).toEqual([
      { title: '酒屋へ発注', assigneeHint: '田中さん', sourceIndex: 0 },
      { title: '在庫を確認', assigneeHint: null, sourceIndex: 1 },
    ])
  })

  it('```json フェンス付きの応答からも抽出する', () => {
    const raw = '```json\n[{"title": "発注", "source_index": 0}]\n```'
    expect(parseLlmDigestExtraction(raw)).toEqual([
      { title: '発注', assigneeHint: null, sourceIndex: 0 },
    ])
  })

  it('壊れたJSONは例外を投げず null（そのグループはスキップ）', () => {
    expect(parseLlmDigestExtraction('not json at all')).toBeNull()
  })

  it('配列でない場合は null', () => {
    expect(parseLlmDigestExtraction(JSON.stringify({ title: 'x' }))).toBeNull()
  })

  it('title欠落の要素は無視して残りを返す', () => {
    const raw = JSON.stringify([{ source_index: 0 }, { title: '発注', source_index: 1 }])
    expect(parseLlmDigestExtraction(raw)).toEqual([{ title: '発注', assigneeHint: null, sourceIndex: 1 }])
  })

  it('空配列は空配列を返す（タスク無しとして扱う）', () => {
    expect(parseLlmDigestExtraction('[]')).toEqual([])
  })
})

describe('buildDigestPushText', () => {
  it('件数と番号付き一覧を含むテキストを生成する', () => {
    const text = buildDigestPushText([
      { digestNumber: 1, title: '酒屋へ発注' },
      { digestNumber: 2, title: '在庫を確認' },
    ])
    expect(text).toContain('2件')
    expect(text).toContain('1. 酒屋へ発注')
    expect(text).toContain('2. 在庫を確認')
  })
})

describe('buildDigestFlexMessage', () => {
  it('上位10件までボタン化し、超過分は「ほか◯件」を表示する', () => {
    const items = Array.from({ length: 13 }, (_, i) => ({
      digestNumber: i + 1,
      title: `タスク${i + 1}`,
      taskId: `task-${i + 1}`,
    }))
    const flex = buildDigestFlexMessage(items)
    expect(flex.type).toBe('flex')
    const bubble = flex.contents as { footer: { contents: unknown[] } }
    expect(bubble.footer.contents.length).toBeLessThanOrEqual(11) // 10ボタン + 「ほか3件」表示
    const serialized = JSON.stringify(flex)
    expect(serialized).toContain('action=digest_done&task=task-1')
    expect(serialized).toContain('ほか3件')
  })

  it('10件以下なら「ほか」表示を出さない', () => {
    const items = [{ digestNumber: 1, title: 'タスク1', taskId: 'task-1' }]
    const flex = buildDigestFlexMessage(items)
    expect(JSON.stringify(flex)).not.toContain('ほか')
  })
})
