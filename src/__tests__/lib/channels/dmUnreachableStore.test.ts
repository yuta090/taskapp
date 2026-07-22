import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * markDmUnreachable / clearDmUnreachable（設計正本 §9.1・A案是正: webhook単独の対称ループ）。
 *
 * 唯一のトリガは src/lib/channels/line/webhookHandler.ts の unfollow(mark)/follow(clear)。
 * push結果（成功/失敗いずれも）はここでは一切トリガにならない（呼び出し元は変わらないが、
 * ここではラッパ自体の契約＝引数・絞り込み条件を検証する）。
 *
 * L-3: orgId引数を追加しorg境界を掛ける（将来共通LINEで1:1が解禁され同一external_user_idが
 * 複数orgに跨っても、1回のupdateが越境して他orgの行まで書き換えない）。
 * L-4: nowではなくevent.occurredAtを書き込む。clear側はイベント順序ガード
 * （`dm_unreachable_at < 対象イベントのoccurredAt` のときだけ解除）を掛け、
 * 古い(再送等で遅延した)followイベントが新しいunfollowのマークを誤って消さないようにする。
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function updateChain(response: any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {}
  for (const m of ['update', 'eq', 'not', 'is', 'lt']) {
    builder[m] = vi.fn(() => builder)
  }
  builder.then = (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onFulfilled: (value: any) => unknown,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onRejected?: (reason: any) => unknown,
  ) => Promise.resolve(response).then(onFulfilled, onRejected)
  return builder
}

let fromResponse: unknown
const fromMock = vi.fn()

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({ from: fromMock })),
}))

const store = await import('@/lib/channels/store')

const OCCURRED_AT = '2026-07-22T00:00:00.000Z'

beforeEach(() => {
  vi.clearAllMocks()
  fromResponse = { error: null }
  fromMock.mockImplementation(() => updateChain(fromResponse))
})

describe('markDmUnreachable', () => {
  it('対象linkの dm_unreachable_at にイベント発生時刻(event.occurredAt)を刻む（nowではない・L-4是正）', async () => {
    await store.markDmUnreachable('org-1', 'acc-1', 'U-1', OCCURRED_AT)

    expect(fromMock).toHaveBeenCalledWith('channel_user_links')
    const call = fromMock.mock.results[0].value
    expect(call.update).toHaveBeenCalledWith({ dm_unreachable_at: OCCURRED_AT })
    expect(call.eq).toHaveBeenCalledWith('channel_account_id', 'acc-1')
    expect(call.eq).toHaveBeenCalledWith('external_user_id', 'U-1')
  })

  it('L-3是正: org_idでも絞り込む（越境更新の防止）', async () => {
    await store.markDmUnreachable('org-1', 'acc-1', 'U-1', OCCURRED_AT)

    const call = fromMock.mock.results[0].value
    expect(call.eq).toHaveBeenCalledWith('org_id', 'org-1')
  })

  it('L-0是正: 生きているlink(revoked_at is null)のみを対象にする', async () => {
    await store.markDmUnreachable('org-1', 'acc-1', 'U-1', OCCURRED_AT)

    const call = fromMock.mock.results[0].value
    expect(call.is).toHaveBeenCalledWith('revoked_at', null)
  })

  it('DBエラーはthrowする', async () => {
    fromResponse = { error: { message: 'boom' } }
    fromMock.mockImplementation(() => updateChain(fromResponse))
    await expect(store.markDmUnreachable('org-1', 'acc-1', 'U-1', OCCURRED_AT)).rejects.toThrow(
      /mark dm_unreachable failed/,
    )
  })
})

describe('clearDmUnreachable', () => {
  it('対象linkの dm_unreachable_at を null に戻す（既にnullの行は対象外にする）', async () => {
    await store.clearDmUnreachable('org-1', 'acc-1', 'U-1', OCCURRED_AT)

    expect(fromMock).toHaveBeenCalledWith('channel_user_links')
    const call = fromMock.mock.results[0].value
    expect(call.update).toHaveBeenCalledWith({ dm_unreachable_at: null })
    expect(call.eq).toHaveBeenCalledWith('channel_account_id', 'acc-1')
    expect(call.eq).toHaveBeenCalledWith('external_user_id', 'U-1')
  })

  it('L-3是正: org_idでも絞り込む（越境更新の防止）', async () => {
    await store.clearDmUnreachable('org-1', 'acc-1', 'U-1', OCCURRED_AT)

    const call = fromMock.mock.results[0].value
    expect(call.eq).toHaveBeenCalledWith('org_id', 'org-1')
  })

  it('L-0是正: 生きているlink(revoked_at is null)のみを対象にする', async () => {
    await store.clearDmUnreachable('org-1', 'acc-1', 'U-1', OCCURRED_AT)

    const call = fromMock.mock.results[0].value
    expect(call.is).toHaveBeenCalledWith('revoked_at', null)
  })

  it('L-4是正: イベント順序ガード。現在の dm_unreachable_at がこのfollowイベントのoccurredAtより前のときだけ解除する', async () => {
    await store.clearDmUnreachable('org-1', 'acc-1', 'U-1', OCCURRED_AT)

    const call = fromMock.mock.results[0].value
    // dm_unreachable_at < event.occurredAt のときのみ解除する（NULLはこの比較を満たさない
    // ため.notによる明示チェックは不要＝ltが自然にNULL行を除外する）。
    expect(call.lt).toHaveBeenCalledWith('dm_unreachable_at', OCCURRED_AT)
  })

  it('DBエラーはthrowする', async () => {
    fromResponse = { error: { message: 'nope' } }
    fromMock.mockImplementation(() => updateChain(fromResponse))
    await expect(store.clearDmUnreachable('org-1', 'acc-1', 'U-1', OCCURRED_AT)).rejects.toThrow(
      /clear dm_unreachable failed/,
    )
  })
})
