import { describe, it, expect } from 'vitest'
import { buildDoneSuggestText, buildDoneSuggestFlex, buildDoneSuggestRetryKey } from '@/lib/channels/doneSuggest/messages'
import { parseDueReminderDonePostback } from '@/lib/reminders/dueReminderPostback'
import { parseDoneSuggestDismissPostback } from '@/lib/channels/doneSuggest/postback'

const TASK_ID = '11111111-1111-4111-8111-111111111111'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

describe('buildDoneSuggestText', () => {
  it('タイトルを埋め込んだ確認文面', () => {
    expect(buildDoneSuggestText('見積書送付')).toBe('「見積書送付」は完了しましたか？')
  })
})

describe('buildDoneSuggestFlex', () => {
  it('altTextはbuildDoneSuggestTextと同一', () => {
    const flex = buildDoneSuggestFlex({ title: '見積書送付', taskId: TASK_ID })
    expect(flex.altText).toBe('「見積書送付」は完了しましたか？')
    expect(flex.type).toBe('flex')
  })

  it('[完了した]は既存due reminder doneのpostback dataを再利用する', () => {
    const flex = buildDoneSuggestFlex({ title: '見積書送付', taskId: TASK_ID })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const contents = flex.contents as any
    const doneButton = contents.footer.contents[0]
    expect(doneButton.action.label).toBe('完了した')
    expect(parseDueReminderDonePostback(doneButton.action.data)).toEqual({ taskId: TASK_ID })
  })

  it('[まだ]は新規dismiss postbackを積む', () => {
    const flex = buildDoneSuggestFlex({ title: '見積書送付', taskId: TASK_ID })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const contents = flex.contents as any
    const dismissButton = contents.footer.contents[1]
    expect(dismissButton.action.label).toBe('まだ')
    expect(parseDoneSuggestDismissPostback(dismissButton.action.data)).toEqual({ taskId: TASK_ID })
  })
})

describe('buildDoneSuggestRetryKey', () => {
  it('UUID v4形状を返す', () => {
    expect(buildDoneSuggestRetryKey(TASK_ID)).toMatch(UUID_RE)
  })

  it('同一task_idなら常に同じキー（決定的）', () => {
    expect(buildDoneSuggestRetryKey(TASK_ID)).toBe(buildDoneSuggestRetryKey(TASK_ID))
  })

  it('task_idが違えば別のキーになる', () => {
    const other = '22222222-2222-4222-8222-222222222222'
    expect(buildDoneSuggestRetryKey(TASK_ID)).not.toBe(buildDoneSuggestRetryKey(other))
  })
})
