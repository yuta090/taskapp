import { describe, it, expect } from 'vitest'
import { parseDigestDonePostback, buildDigestDonePostbackData } from '@/lib/channels/digest/postback'

/**
 * digest消し込みボタンの postback.data 形式: action=digest_done&task=<uuid>
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
})

describe('buildDigestDonePostbackData', () => {
  it('parseDigestDonePostback で往復できる', () => {
    const data = buildDigestDonePostbackData(TASK_ID)
    expect(parseDigestDonePostback(data)).toEqual({ taskId: TASK_ID })
  })
})
