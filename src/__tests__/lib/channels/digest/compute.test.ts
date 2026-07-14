import { describe, it, expect } from 'vitest'
import {
  sanitizeDigestTitle,
  sanitizeAssigneeHint,
  buildDigestExtractionPrompt,
  parseLlmDigestExtraction,
  buildDigestPushText,
  buildDigestFlexMessage,
  buildDigestRetryKey,
  buildMentionTaskTitle,
  buildTaskDoneFlexMessage,
  resolveAssignee,
} from '@/lib/channels/digest/compute'

// 2026-07-14(火) 10:30 JST を基準にする（相対日付の解決・期限の検証）
const NOW = new Date(2026, 6, 14, 10, 30)

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

describe('sanitizeAssigneeHint', () => {
  it('改行・制御文字を除去する', () => {
    expect(sanitizeAssigneeHint('田中さん\n（店長）\t')).toBe('田中さん（店長）')
  })

  it('30字を超える場合は切り詰める', () => {
    const long = 'た'.repeat(40)
    expect(sanitizeAssigneeHint(long).length).toBe(30)
  })

  it('前後の空白を除去する', () => {
    expect(sanitizeAssigneeHint('  田中さん  ')).toBe('田中さん')
  })
})

describe('buildDigestExtractionPrompt', () => {
  it('メッセージ本文をsource_indexつきで含むプロンプトを生成する', () => {
    const messages = buildDigestExtractionPrompt(
      [
        { index: 0, body: '金曜までに酒屋へ発注お願いします' },
        { index: 1, body: 'ラジャー' },
      ],
      NOW,
    )
    expect(messages.length).toBeGreaterThanOrEqual(1)
    const joined = messages.map((m) => m.content).join('\n')
    expect(joined).toContain('金曜までに酒屋へ発注お願いします')
    expect(joined).toContain('JSON')
  })

  it('相対日付を解決させるため基準日時(JST)をプロンプトに注入する（Stage 2.6）', () => {
    const joined = buildDigestExtractionPrompt([{ index: 0, body: '明日までに' }], NOW)
      .map((m) => m.content)
      .join('\n')
    // 「明日」「金曜まで」を絶対日付に解決するには基準日時がないと成立しない
    expect(joined).toContain('2026-07-14')
    expect(joined).toContain('due_date')
    expect(joined).toContain('due_time')
  })
})

describe('parseLlmDigestExtraction', () => {
  it('正しいJSON配列を解析する', () => {
    const raw = JSON.stringify([
      { title: '酒屋へ発注', assignee_hint: '田中さん', source_index: 0 },
      { title: '在庫を確認', source_index: 1 },
    ])
    const result = parseLlmDigestExtraction(raw, NOW)
    expect(result).toEqual([
      { title: '酒屋へ発注', assigneeHint: '田中さん', sourceIndex: 0, dueDate: null, dueTime: null },
      { title: '在庫を確認', assigneeHint: null, sourceIndex: 1, dueDate: null, dueTime: null },
    ])
  })

  it('```json フェンス付きの応答からも抽出する', () => {
    const raw = '```json\n[{"title": "発注", "source_index": 0}]\n```'
    expect(parseLlmDigestExtraction(raw, NOW)).toEqual([
      { title: '発注', assigneeHint: null, sourceIndex: 0, dueDate: null, dueTime: null },
    ])
  })

  it('壊れたJSONは例外を投げず null（そのグループはスキップ）', () => {
    expect(parseLlmDigestExtraction('not json at all', NOW)).toBeNull()
  })

  it('配列でない場合は null', () => {
    expect(parseLlmDigestExtraction(JSON.stringify({ title: 'x' }), NOW)).toBeNull()
  })

  it('title欠落の要素は無視して残りを返す', () => {
    const raw = JSON.stringify([{ source_index: 0 }, { title: '発注', source_index: 1 }])
    expect(parseLlmDigestExtraction(raw, NOW)).toEqual([
      { title: '発注', assigneeHint: null, sourceIndex: 1, dueDate: null, dueTime: null },
    ])
  })

  it('空配列は空配列を返す（タスク無しとして扱う）', () => {
    expect(parseLlmDigestExtraction('[]', NOW)).toEqual([])
  })

  it('assignee_hintもtitleと同様にサニタイズする（改行除去・30字切り詰め）', () => {
    const raw = JSON.stringify([
      { title: '発注', assignee_hint: '田中さん\n（店長）', source_index: 0 },
      { title: '発注2', assignee_hint: 'た'.repeat(40), source_index: 1 },
    ])
    const result = parseLlmDigestExtraction(raw, NOW)
    expect(result?.[0].assigneeHint).toBe('田中さん（店長）')
    expect(result?.[1].assigneeHint?.length).toBe(30)
  })

  it('due_date / due_time を取り込む（Stage 2.6）', () => {
    const raw = JSON.stringify([
      { title: '酒屋へ発注', due_date: '2026-07-17', due_time: '17:00', source_index: 0 },
    ])
    expect(parseLlmDigestExtraction(raw, NOW)?.[0]).toMatchObject({
      dueDate: '2026-07-17',
      dueTime: '17:00',
    })
  })

  it('LLMが返した過去日・壊れた期限は保存前に落とす（Stage 2.6）', () => {
    const raw = JSON.stringify([
      { title: '過去日', due_date: '2026-07-01', source_index: 0 },
      { title: '年の取り違え', due_date: '2027-07-17', source_index: 1 },
      { title: '形式不正', due_date: '来週金曜', source_index: 2 },
      { title: '時刻のみ', due_time: '17:00', source_index: 3 },
    ])
    const result = parseLlmDigestExtraction(raw, NOW)
    expect(result?.map((t) => [t.dueDate, t.dueTime])).toEqual([
      [null, null],
      [null, null],
      [null, null],
      [null, null],
    ])
  })
})

describe('resolveAssignee（Stage 2.6 §1-2: メンション優先・LLMは補助）', () => {
  it('メンションで userId が取れたらラベルと userId の両方を持つ', () => {
    expect(
      resolveAssignee([{ userId: 'U-yamada', displayName: '山田' }], 'LLMが読んだ別の名前'),
    ).toEqual({ assigneeHint: '山田', assigneeExternalUserId: 'U-yamada' })
  })

  it('userId が取れないメンション（未同意）でも名前ラベルは残す', () => {
    expect(resolveAssignee([{ userId: null, displayName: '田中' }], null)).toEqual({
      assigneeHint: '田中',
      assigneeExternalUserId: null,
    })
  })

  it('メンションが無ければLLMが読んだ名前をラベルに使う', () => {
    expect(resolveAssignee(undefined, '佐藤さん')).toEqual({
      assigneeHint: '佐藤さん',
      assigneeExternalUserId: null,
    })
  })

  it('メンションはLLMの推測を上書きする（発話者の明示的な指名の方が確か）', () => {
    const resolved = resolveAssignee([{ userId: 'U-a', displayName: '山田' }], '田中さん')
    expect(resolved.assigneeHint).toBe('山田')
  })

  it('複数メンションは先頭1件を担当にする（複数担当は誰も自分ごとにしない）', () => {
    const resolved = resolveAssignee(
      [
        { userId: 'U-a', displayName: '山田' },
        { userId: 'U-b', displayName: '田中' },
      ],
      null,
    )
    expect(resolved).toEqual({ assigneeHint: '山田', assigneeExternalUserId: 'U-a' })
  })

  it('担当が全く取れなければ null', () => {
    expect(resolveAssignee([], null)).toEqual({
      assigneeHint: null,
      assigneeExternalUserId: null,
    })
  })
})

describe('buildDigestPushText', () => {
  const TODAY = '2026-07-14'

  it('件数と番号付き一覧を含むテキストを生成する', () => {
    const text = buildDigestPushText(
      [
        { digestNumber: 1, title: '酒屋へ発注' },
        { digestNumber: 2, title: '在庫を確認' },
      ],
      TODAY,
    )
    expect(text).toContain('2件')
    expect(text).toContain('1. 酒屋へ発注')
    expect(text).toContain('2. 在庫を確認')
  })

  it('期限と担当を行に添える（Stage 2.6）', () => {
    const text = buildDigestPushText(
      [
        {
          digestNumber: 1,
          title: '酒屋へ発注',
          dueDate: '2026-07-17',
          dueTime: '17:00',
          assigneeHint: '山田',
        },
      ],
      TODAY,
    )
    expect(text).toContain('1. 酒屋へ発注')
    expect(text).toContain('⏰7/17(金) 17:00')
    expect(text).toContain('👤山田さん')
  })

  it('期限超過は ⚠️ で示す（Stage 2.6: 毎朝openを全件送るため、これがリマインドの実体）', () => {
    const text = buildDigestPushText(
      [{ digestNumber: 1, title: '請求書の確認', dueDate: '2026-07-12', dueTime: null }],
      TODAY,
    )
    expect(text).toContain('⚠️7/12(日) 期限超過')
  })

  it('期限なし・担当なしの行には ⏰ / 👤 を出さない（空欄を作らない）', () => {
    const text = buildDigestPushText([{ digestNumber: 1, title: '議事録の共有' }], TODAY)
    expect(text).toContain('1. 議事録の共有')
    expect(text).not.toContain('⏰')
    expect(text).not.toContain('👤')
  })

  it('既に敬称のついた担当名に「さん」を重ねない', () => {
    const text = buildDigestPushText(
      [{ digestNumber: 1, title: '発注', assigneeHint: '田中さん' }],
      TODAY,
    )
    expect(text).toContain('👤田中さん')
    expect(text).not.toContain('さんさん')
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

describe('buildDigestRetryKey', () => {
  it('同じgroupId・同じ日付なら同じキーを返す（同日cron再実行での二重配信対策）', () => {
    const a = buildDigestRetryKey('group-1', '2026-07-11')
    const b = buildDigestRetryKey('group-1', '2026-07-11')
    expect(a).toBe(b)
  })

  it('groupIdが異なれば異なるキーを返す', () => {
    expect(buildDigestRetryKey('group-1', '2026-07-11')).not.toBe(
      buildDigestRetryKey('group-2', '2026-07-11'),
    )
  })

  it('日付が異なれば異なるキーを返す（翌日は新規キー）', () => {
    expect(buildDigestRetryKey('group-1', '2026-07-11')).not.toBe(
      buildDigestRetryKey('group-1', '2026-07-12'),
    )
  })

  it('UUID形式（v4相当）の文字列を返す', () => {
    const key = buildDigestRetryKey('group-1', '2026-07-11')
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
})

describe('buildMentionTaskTitle（Stage 2.5 §2: メンション即時タスク化）', () => {
  it('本文からメンション区間を除去し、残りをsanitizeDigestTitleと同様に整形する', () => {
    const title = buildMentionTaskTitle('@AgentPM秘書 金曜までに見積提出', [{ index: 0, length: 10 }])
    expect(title).toBe('金曜までに見積提出')
  })

  it('前後の空白・改行・制御文字も除去する', () => {
    const title = buildMentionTaskTitle('@bot \n 発注お願いします \t', [{ index: 0, length: 4 }])
    expect(title).toBe('発注お願いします')
  })

  it('複数区間を後ろから除去する（indexずれ対策）', () => {
    const title = buildMentionTaskTitle('@田中 @bot 見積お願いします', [
      { index: 0, length: 3 },
      { index: 4, length: 4 },
    ])
    expect(title).toBe('見積お願いします')
  })

  it('メンション除去後に50字を超える場合は切り詰める', () => {
    const long = '@bot ' + 'あ'.repeat(60)
    const title = buildMentionTaskTitle(long, [{ index: 0, length: 4 }])
    expect(title.length).toBe(50)
  })

  it('メンション除去後に空文字になる場合は空文字を返す（呼び出し側でタスク化を止める）', () => {
    const title = buildMentionTaskTitle('@AgentPM秘書', [{ index: 0, length: 10 }])
    expect(title).toBe('')
  })

  it('spansが空なら本文全体をsanitizeDigestTitleと同様に整形する', () => {
    expect(buildMentionTaskTitle('  発注お願いします  ', [])).toBe('発注お願いします')
  })
})

describe('buildTaskDoneFlexMessage（Stage 2.5 §3-1: 完了の記名化＋取り消し）', () => {
  const TASK_ID = '11111111-1111-4111-8111-111111111111'

  it('doneByDisplayNameありなら記名文言をbodyに含める', () => {
    const flex = buildTaskDoneFlexMessage({
      title: '酒屋へ発注',
      doneByDisplayName: '田中太郎',
      taskId: TASK_ID,
    })
    const serialized = JSON.stringify(flex)
    expect(serialized).toContain('田中太郎さんが')
    expect(serialized).toContain('酒屋へ発注')
    expect(serialized).toContain('完了にしました')
  })

  it('doneByDisplayNameがnullなら記名無しの従来文言', () => {
    const flex = buildTaskDoneFlexMessage({ title: '酒屋へ発注', doneByDisplayName: null, taskId: TASK_ID })
    const serialized = JSON.stringify(flex)
    expect(serialized).not.toContain('さんが')
    expect(serialized).toContain('『酒屋へ発注』を完了にしました')
  })

  it('footerに取り消すボタン(postback action=digest_undo)を含む', () => {
    const flex = buildTaskDoneFlexMessage({ title: '酒屋へ発注', doneByDisplayName: null, taskId: TASK_ID })
    const serialized = JSON.stringify(flex)
    expect(serialized).toContain('取り消す')
    expect(serialized).toContain(`action=digest_undo&task=${TASK_ID}`)
  })

  it('displayNameは制御文字/改行を除去してから埋め込む（LINE APIからの非信頼文字列）', () => {
    const flex = buildTaskDoneFlexMessage({
      title: '酒屋へ発注',
      doneByDisplayName: '田中\n太郎\t',
      taskId: TASK_ID,
    })
    const serialized = JSON.stringify(flex)
    expect(serialized).toContain('田中太郎さんが')
  })

  it('titleも制御文字を除去してから埋め込む', () => {
    const flex = buildTaskDoneFlexMessage({
      title: '酒屋へ\n発注',
      doneByDisplayName: null,
      taskId: TASK_ID,
    })
    const serialized = JSON.stringify(flex)
    expect(serialized).toContain('酒屋へ発注')
  })
})
