import { describe, it, expect } from 'vitest'
import { appendOnlyAddition } from '@/lib/minutes/rebase'
import { SPEC_LINE_REGEX, TASK_MARKER_REGEX } from '@/lib/minutes/markdown'

// AI秘書・チャットの minutes_append(rpc_minutes_append)は必ず「今の本文の後ろに
// \n\n + 追記内容」を足すだけ(supabase/migrations/20260912112247_meeting_minutes_editing.sql
// 102〜104行)。この \n\n の区切りが実際にあるかどうかだけを目印に、「末尾への追記」と
// 「そう見えるだけの別の書き換え」(タスク化の目印付与など)を区別する。

describe('appendOnlyAddition', () => {
  it('theirsがbase + "\\n\\n" + 追記の形なら、追記された分だけを返す', () => {
    const base = '# 定例MTG\n\n決まったこと'
    const theirs = '# 定例MTG\n\n決まったこと\n\nAI秘書が追記した分'

    expect(appendOnlyAddition(base, theirs)).toBe('AI秘書が追記した分')
  })

  it('致命3の再現: タスク化で目印だけが末尾にくっついた(前方一致だが\\n\\n区切りが無い)場合は null', () => {
    // 議事録の最終行が未マークのSPEC行だと、rpc_parse_meeting_minutesは目印
    // " <!--task:uuid-->" をその行の末尾にそのまま足して全文を書き戻す。
    // これは base の前方一致になるが、\n\n を挟まないので「末尾への追記」ではない。
    const base = '# 定例MTG\n\n- [ ] SPEC(仕様書名): 内容'
    const theirs = `${base} <!--task:11111111-1111-1111-1111-111111111111-->`

    expect(appendOnlyAddition(base, theirs)).toBeNull()
  })

  it('theirsがbaseと同じ(実際には何も追記されていない)なら null', () => {
    const base = '# 定例MTG\n\n決まったこと'
    expect(appendOnlyAddition(base, base)).toBeNull()
  })

  it('theirsがbaseより短い(削られている)なら null', () => {
    const base = '# 定例MTG\n\n決まったこと\n\nAI秘書が追記した分'
    const theirs = '# 定例MTG\n\n決まったこと'

    expect(appendOnlyAddition(base, theirs)).toBeNull()
  })

  it('途中(base自体)が書き換えられているなら null', () => {
    const base = '# 定例MTG\n\n決まったこと'
    const theirs = '# 定例MTG(改題)\n\n決まったこと\n\nAI秘書が追記した分'

    expect(appendOnlyAddition(base, theirs)).toBeNull()
  })

  it('baseが空＋theirsあり: theirs をそのまま(追記された分として)返す', () => {
    expect(appendOnlyAddition('', 'AI秘書が最初に書いた本文')).toBe('AI秘書が最初に書いた本文')
  })

  it('baseが空＋theirsも空: null', () => {
    expect(appendOnlyAddition('', '')).toBeNull()
  })

  it('低3: 追記が空白だけなら null（意味の無い差し込みをしない）', () => {
    const base = '# 定例MTG\n\n決まったこと'
    expect(appendOnlyAddition(base, `${base}\n\n   `)).toBeNull()
    expect(appendOnlyAddition(base, `${base}\n\n\n`)).toBeNull()
    // base が空のときも同様
    expect(appendOnlyAddition('', '   ')).toBeNull()
  })

  it('追記の中のSPEC行と目印は変わらず残る(合流はMarkdown片を返すだけで書き換えない)', () => {
    const base = '# 定例MTG\n\n決まったこと'
    const specLine = '- [ ] SPEC(仕様書名): 内容 <!--task:11111111-1111-1111-1111-111111111111-->'
    const theirs = `${base}\n\n${specLine}`

    const addition = appendOnlyAddition(base, theirs)
    expect(addition).toBe(specLine)
    expect(SPEC_LINE_REGEX.test(addition ?? '')).toBe(true)
    expect(TASK_MARKER_REGEX.test(addition ?? '')).toBe(true)
  })
})
