import { describe, it, expect } from 'vitest'
import {
  parseDigestDonePostback,
  buildDigestDonePostbackData,
  parseDigestUndoPostback,
  buildDigestUndoPostbackData,
  parseDigestPromotePostback,
  buildDigestPromotePostbackData,
  parseDigestRejectPostback,
  buildDigestRejectPostbackData,
} from '@/lib/channels/digest/postback'

/**
 * digest消し込みボタンの postback.data 形式: action=digest_done&task=<uuid>
 * 取り消しボタン(Stage 2.5 §3-2): action=digest_undo&task=<uuid>
 * 責任者確認(Stage 2.7-B): 承認 action=digest_promote / 却下 action=digest_reject
 */

const TASK_ID = '11111111-1111-4111-8111-111111111111'

describe('parseDigestDonePostback', () => {
  it('正しい形式を解析する', () => {
    expect(parseDigestDonePostback(`action=digest_done&task=${TASK_ID}`)).toEqual({ taskId: TASK_ID })
  })

  it('action が異なれば null', () => {
    expect(parseDigestDonePostback(`action=other&task=${TASK_ID}`)).toBeNull()
  })

  it('task が UUID でなければ null', () => {
    expect(parseDigestDonePostback('action=digest_done&task=not-a-uuid')).toBeNull()
  })

  it('task 欠落は null', () => {
    expect(parseDigestDonePostback('action=digest_done')).toBeNull()
  })

  it('壊れた文字列は例外を投げず null', () => {
    expect(parseDigestDonePostback('')).toBeNull()
  })

  it('digest_undo形式は digest_done として解析しない（判別）', () => {
    expect(parseDigestDonePostback(`action=digest_undo&task=${TASK_ID}`)).toBeNull()
  })
})

describe('buildDigestDonePostbackData', () => {
  it('parseDigestDonePostback で往復できる', () => {
    const data = buildDigestDonePostbackData(TASK_ID)
    expect(parseDigestDonePostback(data)).toEqual({ taskId: TASK_ID })
  })
})

describe('parseDigestUndoPostback', () => {
  it('正しい形式を解析する', () => {
    expect(parseDigestUndoPostback(`action=digest_undo&task=${TASK_ID}`)).toEqual({ taskId: TASK_ID })
  })

  it('action が異なれば null', () => {
    expect(parseDigestUndoPostback(`action=digest_done&task=${TASK_ID}`)).toBeNull()
  })

  it('task が UUID でなければ null', () => {
    expect(parseDigestUndoPostback('action=digest_undo&task=not-a-uuid')).toBeNull()
  })

  it('task 欠落は null', () => {
    expect(parseDigestUndoPostback('action=digest_undo')).toBeNull()
  })

  it('壊れた文字列は例外を投げず null', () => {
    expect(parseDigestUndoPostback('')).toBeNull()
  })
})

describe('buildDigestUndoPostbackData', () => {
  it('parseDigestUndoPostback で往復できる', () => {
    const data = buildDigestUndoPostbackData(TASK_ID)
    expect(parseDigestUndoPostback(data)).toEqual({ taskId: TASK_ID })
  })

  it('parseDigestDonePostback では解析されない（判別）', () => {
    const data = buildDigestUndoPostbackData(TASK_ID)
    expect(parseDigestDonePostback(data)).toBeNull()
  })
})

describe('parseDigestPromotePostback / parseDigestRejectPostback（責任者確認）', () => {
  it('promote 正しい形式を解析する', () => {
    expect(parseDigestPromotePostback(`action=digest_promote&task=${TASK_ID}`)).toEqual({ taskId: TASK_ID })
  })

  it('reject 正しい形式を解析する', () => {
    expect(parseDigestRejectPostback(`action=digest_reject&task=${TASK_ID}`)).toEqual({ taskId: TASK_ID })
  })

  it('task が UUID でなければ null', () => {
    expect(parseDigestPromotePostback('action=digest_promote&task=not-a-uuid')).toBeNull()
    expect(parseDigestRejectPostback('action=digest_reject&task=not-a-uuid')).toBeNull()
  })

  it('壊れた文字列は例外を投げず null', () => {
    expect(parseDigestPromotePostback('')).toBeNull()
    expect(parseDigestRejectPostback('')).toBeNull()
  })

  it('promote と reject / done / undo は相互に判別される（取り違え防止）', () => {
    const promote = buildDigestPromotePostbackData(TASK_ID)
    const reject = buildDigestRejectPostbackData(TASK_ID)
    // promote は reject/done/undo として解析されない
    expect(parseDigestRejectPostback(promote)).toBeNull()
    expect(parseDigestDonePostback(promote)).toBeNull()
    expect(parseDigestUndoPostback(promote)).toBeNull()
    // reject は promote/done/undo として解析されない
    expect(parseDigestPromotePostback(reject)).toBeNull()
    expect(parseDigestDonePostback(reject)).toBeNull()
    expect(parseDigestUndoPostback(reject)).toBeNull()
    // 消し込み(done)を承認(promote)と取り違えない
    expect(parseDigestPromotePostback(buildDigestDonePostbackData(TASK_ID))).toBeNull()
  })

  it('builder で往復できる', () => {
    expect(parseDigestPromotePostback(buildDigestPromotePostbackData(TASK_ID))).toEqual({ taskId: TASK_ID })
    expect(parseDigestRejectPostback(buildDigestRejectPostbackData(TASK_ID))).toEqual({ taskId: TASK_ID })
  })
})
