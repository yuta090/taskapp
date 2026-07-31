import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * updateChannelGroupMetadata に「練習の進み具合(tutorial)」を書けるようにした分の回帰。
 *
 * metadata（jsonb）は Teams の serviceUrl / teamId / tenantId と同居する1つの器なので、
 * 練習の状態を書いたときに**既存のキーを壊さない**（＝上書きではなくマージ）ことを担保する。
 * 壊すと Teams からの能動送信の宛先が消える。
 */

let selectResponse: { data: unknown; error: unknown }
let updateResponse: { error: unknown }
const updateMock = vi.fn()

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: () => Promise.resolve(selectResponse) }),
      }),
      update: (patch: unknown) => {
        updateMock(patch)
        return { eq: () => Promise.resolve(updateResponse) }
      },
    }),
  })),
}))

const { updateChannelGroupMetadata } = await import('@/lib/channels/store')

beforeEach(() => {
  vi.clearAllMocks()
  selectResponse = { data: { metadata: null }, error: null }
  updateResponse = { error: null }
})

describe('updateChannelGroupMetadata（tutorial）', () => {
  it('練習の状態を metadata.tutorial として書ける', async () => {
    await updateChannelGroupMetadata('grp-1', {
      tutorial: { step: 'awaiting_add', startedAt: '2026-07-30T09:00:00.000Z' },
    })

    expect(updateMock).toHaveBeenCalledWith({
      metadata: { tutorial: { step: 'awaiting_add', startedAt: '2026-07-30T09:00:00.000Z' } },
    })
  })

  it('Teams の serviceUrl など既存のキーを壊さない（マージ更新）', async () => {
    selectResponse = {
      data: { metadata: { serviceUrl: 'https://smba.example', teamId: 'team-1' } },
      error: null,
    }

    await updateChannelGroupMetadata('grp-1', {
      tutorial: { step: 'awaiting_done', taskId: 'task-9', digestNumber: 2, startedAt: '2026-07-30T09:00:00.000Z' },
    })

    expect(updateMock).toHaveBeenCalledWith({
      metadata: {
        serviceUrl: 'https://smba.example',
        teamId: 'team-1',
        tutorial: {
          step: 'awaiting_done',
          taskId: 'task-9',
          digestNumber: 2,
          startedAt: '2026-07-30T09:00:00.000Z',
        },
      },
    })
  })

  it('古い練習の状態は新しいもので置き換わる（段階が混ざらない）', async () => {
    selectResponse = {
      data: { metadata: { tutorial: { step: 'awaiting_add', startedAt: '2026-07-30T09:00:00.000Z' } } },
      error: null,
    }

    await updateChannelGroupMetadata('grp-1', {
      tutorial: { step: 'finished', startedAt: '2026-07-30T09:00:00.000Z' },
    })

    expect(updateMock).toHaveBeenCalledWith({
      metadata: { tutorial: { step: 'finished', startedAt: '2026-07-30T09:00:00.000Z' } },
    })
  })
})
