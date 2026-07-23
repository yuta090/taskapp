import { describe, it, expect } from 'vitest'
import {
  buildDoneSuggestDismissPostbackData,
  parseDoneSuggestDismissPostback,
} from '@/lib/channels/doneSuggest/postback'

const TASK_ID = '11111111-1111-4111-8111-111111111111'

describe('done suggest dismiss postback', () => {
  it('build → parse で往復できる', () => {
    const data = buildDoneSuggestDismissPostbackData(TASK_ID)
    expect(data).toBe(`action=done_suggest_dismiss&task=${TASK_ID}`)
    expect(parseDoneSuggestDismissPostback(data)).toEqual({ taskId: TASK_ID })
  })

  it('action不一致はnull', () => {
    expect(parseDoneSuggestDismissPostback(`action=due_reminder_done&task=${TASK_ID}`)).toBeNull()
  })

  it('taskが欠落/不正UUIDはnull', () => {
    expect(parseDoneSuggestDismissPostback('action=done_suggest_dismiss')).toBeNull()
    expect(parseDoneSuggestDismissPostback('action=done_suggest_dismiss&task=not-a-uuid')).toBeNull()
  })

  it('壊れたクエリ文字列はnull', () => {
    // URLSearchParamsはほぼ何でもパースできるが、念のため例外系も見る
    expect(parseDoneSuggestDismissPostback('')).toBeNull()
  })
})
