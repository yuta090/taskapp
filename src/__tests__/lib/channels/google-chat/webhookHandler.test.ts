import { describe, it, expect, vi } from 'vitest'
import {
  handleGoogleChatWebhook,
  buildAcceptedText,
  INVALID_TEXT,
  CODE_ONLY_LINKED_TEXT,
  CODE_ONLY_ALREADY_TEXT,
  type GoogleChatWebhookDeps,
  type GoogleChatEvent,
} from '@/lib/channels/google-chat/webhookHandler'

const ACCOUNT = { id: 'acc-gchat-plat' }

function event(over: Partial<GoogleChatEvent> = {}): GoogleChatEvent {
  return {
    type: 'MESSAGE',
    space: { name: 'spaces/AAAA' },
    message: { name: 'spaces/AAAA/messages/1', text: 'こんにちは', argumentText: 'こんにちは' },
    user: { name: 'users/U1' },
    ...over,
  }
}

function makeDeps(over: Partial<GoogleChatWebhookDeps> = {}): GoogleChatWebhookDeps {
  return {
    loadPlatformAccount: vi.fn().mockResolvedValue(ACCOUNT),
    findActiveGroup: vi.fn().mockResolvedValue(null),
    normalizeClaimCode: vi.fn().mockReturnValue(null),
    hashClaimCode: vi.fn((c: string) => `hash(${c})`),
    findValidClaimCode: vi.fn().mockResolvedValue(null),
    hasExternalChatChannels: vi.fn().mockResolvedValue(true),
    externalChatGroupCapacity: vi.fn().mockResolvedValue({ activeCount: 0, max: 50 }),
    createPendingClaim: vi.fn().mockResolvedValue({ challengeLabel: 'AB12' }),
    redeemCodeOnly: vi.fn().mockResolvedValue('linked'),
    generateChallengeLabel: vi.fn().mockReturnValue('AB12'),
    registerInvalidAttempt: vi.fn().mockReturnValue(false),
    ...over,
  }
}

describe('handleGoogleChatWebhook — MESSAGE以外/糖衣', () => {
  it('ADDED_TO_SPACE は無処理200（記録0・発話0）', async () => {
    const deps = makeDeps()
    const res = await handleGoogleChatWebhook(event({ type: 'ADDED_TO_SPACE' }), deps)
    expect(res).toEqual({ status: 200, replyText: null })
    expect(deps.loadPlatformAccount).not.toHaveBeenCalled()
    expect(deps.findActiveGroup).not.toHaveBeenCalled()
  })

  it('REMOVED_FROM_SPACE は無処理200', async () => {
    const deps = makeDeps()
    const res = await handleGoogleChatWebhook(event({ type: 'REMOVED_FROM_SPACE' }), deps)
    expect(res).toEqual({ status: 200, replyText: null })
  })

  it('未知のtypeは無処理200', async () => {
    const deps = makeDeps()
    const res = await handleGoogleChatWebhook(event({ type: 'CARD_CLICKED' }), deps)
    expect(res).toEqual({ status: 200, replyText: null })
  })
})

describe('handleGoogleChatWebhook — claimed スペース', () => {
  it('claimed（findActiveGroup有）は無処理200・processClaimLimboを呼ばない', async () => {
    const deps = makeDeps({
      findActiveGroup: vi.fn().mockResolvedValue({ id: 'grp-1', orgId: 'org-1', spaceId: 'space-1' }),
    })
    const res = await handleGoogleChatWebhook(event({ message: { text: 'GC-XXXX', argumentText: 'GC-XXXX' } }), deps)
    expect(res).toEqual({ status: 200, replyText: null })
    // claim限定のdepsは一切呼ばれない（二重処理防止）
    expect(deps.normalizeClaimCode).not.toHaveBeenCalled()
    expect(deps.findValidClaimCode).not.toHaveBeenCalled()
  })
})

describe('handleGoogleChatWebhook — limbo（未claim）', () => {
  it('合言葉でない@メンションは沈黙（replyText=null・記録0）', async () => {
    const deps = makeDeps({ normalizeClaimCode: vi.fn().mockReturnValue(null) })
    const res = await handleGoogleChatWebhook(event(), deps)
    expect(res).toEqual({ status: 200, replyText: null })
  })

  it('無効コードは INVALID_TEXT がreplyTextに乗る（レート未超過）', async () => {
    const deps = makeDeps({
      normalizeClaimCode: vi.fn().mockReturnValue('CODE26'),
      findValidClaimCode: vi.fn().mockResolvedValue(null),
      registerInvalidAttempt: vi.fn().mockReturnValue(false),
    })
    const res = await handleGoogleChatWebhook(
      event({ message: { text: 'GC-XXXX', argumentText: 'GC-XXXX' } }),
      deps,
    )
    expect(res).toEqual({ status: 200, replyText: INVALID_TEXT })
  })

  it('無効コード×レート超過は無返信', async () => {
    const deps = makeDeps({
      normalizeClaimCode: vi.fn().mockReturnValue('CODE26'),
      findValidClaimCode: vi.fn().mockResolvedValue(null),
      registerInvalidAttempt: vi.fn().mockReturnValue(true),
    })
    const res = await handleGoogleChatWebhook(
      event({ message: { text: 'GC-XXXX', argumentText: 'GC-XXXX' } }),
      deps,
    )
    expect(res).toEqual({ status: 200, replyText: null })
  })

  it('code_only 有効コード×Pro: 即時償還してLINKED文言がreplyTextに乗る', async () => {
    const deps = makeDeps({
      normalizeClaimCode: vi.fn().mockReturnValue('CODE26'),
      findValidClaimCode: vi.fn().mockResolvedValue({
        id: 'lc-1',
        orgId: 'org-1',
        spaceId: 'space-1',
        bindingMode: 'code_only',
      }),
      redeemCodeOnly: vi.fn().mockResolvedValue('linked'),
    })
    const res = await handleGoogleChatWebhook(
      event({ message: { text: 'GC-CODE', argumentText: 'GC-CODE' } }),
      deps,
    )
    expect(res).toEqual({ status: 200, replyText: CODE_ONLY_LINKED_TEXT })
    expect(deps.redeemCodeOnly).toHaveBeenCalledWith(
      'hash(CODE26)',
      'acc-gchat-plat',
      'spaces/AAAA',
      null,
      50,
    )
  })

  it('code_only 既に別コードで登録済みは ALREADY 文言', async () => {
    const deps = makeDeps({
      normalizeClaimCode: vi.fn().mockReturnValue('CODE26'),
      findValidClaimCode: vi.fn().mockResolvedValue({
        id: 'lc-1',
        orgId: 'org-1',
        spaceId: 'space-1',
        bindingMode: 'code_only',
      }),
      redeemCodeOnly: vi.fn().mockResolvedValue('already_linked'),
    })
    const res = await handleGoogleChatWebhook(
      event({ message: { text: 'GC-CODE', argumentText: 'GC-CODE' } }),
      deps,
    )
    expect(res).toEqual({ status: 200, replyText: CODE_ONLY_ALREADY_TEXT })
  })

  it('web_approval 有効コード×Pro: pending claim作成＋確認番号がreplyTextに乗る', async () => {
    const createPendingClaim = vi.fn().mockResolvedValue({ challengeLabel: 'AB12' })
    const deps = makeDeps({
      normalizeClaimCode: vi.fn().mockReturnValue('CODE26'),
      findValidClaimCode: vi.fn().mockResolvedValue({
        id: 'lc-1',
        orgId: 'org-1',
        spaceId: 'space-1',
        bindingMode: 'web_approval',
      }),
      createPendingClaim,
    })
    const res = await handleGoogleChatWebhook(
      event({ message: { text: 'GC-CODE', argumentText: 'GC-CODE' } }),
      deps,
    )
    expect(res).toEqual({ status: 200, replyText: buildAcceptedText('AB12') })
    expect(createPendingClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        linkCodeId: 'lc-1',
        accountId: 'acc-gchat-plat',
        externalGroupId: 'spaces/AAAA',
        orgId: 'org-1',
        spaceId: 'space-1',
        challengeLabel: 'AB12',
      }),
    )
  })

  it('Proゲート: external_chat_channels 不所持は確立させずINVALID文言に畳む', async () => {
    const createPendingClaim = vi.fn()
    const deps = makeDeps({
      normalizeClaimCode: vi.fn().mockReturnValue('CODE26'),
      findValidClaimCode: vi.fn().mockResolvedValue({
        id: 'lc-1',
        orgId: 'org-free',
        spaceId: 'space-1',
        bindingMode: 'web_approval',
      }),
      hasExternalChatChannels: vi.fn().mockResolvedValue(false),
      createPendingClaim,
    })
    const res = await handleGoogleChatWebhook(
      event({ message: { text: 'GC-CODE', argumentText: 'GC-CODE' } }),
      deps,
    )
    expect(res).toEqual({ status: 200, replyText: INVALID_TEXT })
    expect(createPendingClaim).not.toHaveBeenCalled()
  })

  it('容量超過は確立させずINVALID文言に畳む', async () => {
    const deps = makeDeps({
      normalizeClaimCode: vi.fn().mockReturnValue('CODE26'),
      findValidClaimCode: vi.fn().mockResolvedValue({
        id: 'lc-1',
        orgId: 'org-1',
        spaceId: 'space-1',
        bindingMode: 'web_approval',
      }),
      externalChatGroupCapacity: vi.fn().mockResolvedValue({ activeCount: 50, max: 50 }),
    })
    const res = await handleGoogleChatWebhook(
      event({ message: { text: 'GC-CODE', argumentText: 'GC-CODE' } }),
      deps,
    )
    expect(res).toEqual({ status: 200, replyText: INVALID_TEXT })
  })

  it('argumentText が無い場合は text にフォールバックする', async () => {
    const deps = makeDeps({
      normalizeClaimCode: vi.fn().mockReturnValue('CODE26'),
      findValidClaimCode: vi.fn().mockResolvedValue({
        id: 'lc-1',
        orgId: 'org-1',
        spaceId: 'space-1',
        bindingMode: 'code_only',
      }),
    })
    await handleGoogleChatWebhook(event({ message: { text: 'GC-CODE' } }), deps)
    expect(deps.normalizeClaimCode).toHaveBeenCalledWith('GC-CODE')
  })
})

describe('handleGoogleChatWebhook — platform account', () => {
  it('platform account 無しは無処理200', async () => {
    const deps = makeDeps({ loadPlatformAccount: vi.fn().mockResolvedValue(null) })
    const res = await handleGoogleChatWebhook(event(), deps)
    expect(res).toEqual({ status: 200, replyText: null })
    expect(deps.findActiveGroup).not.toHaveBeenCalled()
  })
})
