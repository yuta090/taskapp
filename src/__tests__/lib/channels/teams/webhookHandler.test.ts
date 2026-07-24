import { describe, it, expect, vi } from 'vitest'
import {
  handleTeamsWebhook,
  buildAcceptedText,
  INVALID_TEXT,
  CODE_ONLY_LINKED_TEXT,
  CODE_ONLY_ALREADY_TEXT,
  type TeamsWebhookDeps,
} from '@/lib/channels/teams/webhookHandler'
import type { NormalizedTeamsActivity } from '@/lib/channels/teams/activity'

const ACCOUNT = { id: 'acc-teams-plat' }

function activity(over: Partial<NormalizedTeamsActivity> = {}): NormalizedTeamsActivity {
  return {
    externalGroupId: '19:abcd1234@thread.tacv2',
    externalUserId: '29:user-1',
    isBot: false,
    activityId: 'act-1',
    text: 'こんにちは',
    serviceUrl: 'https://smba.trafficmanager.net/amer/',
    conversationId: '19:abcd1234@thread.tacv2;messageid=1',
    teamId: '19:team-abc@thread.tacv2',
    tenantId: 'tenant-1',
    occurredAt: '2026-07-24T00:00:00.000Z',
    ...over,
  }
}

function makeDeps(over: Partial<TeamsWebhookDeps> = {}): TeamsWebhookDeps {
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
    reply: vi.fn().mockResolvedValue(undefined),
    ...over,
  }
}

describe('handleTeamsWebhook — 自Bot/他Bot', () => {
  it('isBot:true は無処理（platform account 解決すら行わない）', async () => {
    const deps = makeDeps()
    await handleTeamsWebhook(activity({ isBot: true }), deps)
    expect(deps.loadPlatformAccount).not.toHaveBeenCalled()
    expect(deps.findActiveGroup).not.toHaveBeenCalled()
    expect(deps.reply).not.toHaveBeenCalled()
  })
})

describe('handleTeamsWebhook — platform account', () => {
  it('platform account 無しは無処理', async () => {
    const deps = makeDeps({ loadPlatformAccount: vi.fn().mockResolvedValue(null) })
    await handleTeamsWebhook(activity(), deps)
    expect(deps.findActiveGroup).not.toHaveBeenCalled()
    expect(deps.reply).not.toHaveBeenCalled()
  })
})

describe('handleTeamsWebhook — claimed グループ', () => {
  it('claimed（findActiveGroup有）は無処理・processClaimLimbo系のdepsを一切呼ばない（PR-2の役目）', async () => {
    const deps = makeDeps({
      findActiveGroup: vi.fn().mockResolvedValue({ id: 'grp-1', orgId: 'org-1', spaceId: 'space-1' }),
    })
    await handleTeamsWebhook(activity({ text: 'GC-XXXX' }), deps)
    expect(deps.normalizeClaimCode).not.toHaveBeenCalled()
    expect(deps.findValidClaimCode).not.toHaveBeenCalled()
    expect(deps.reply).not.toHaveBeenCalled()
  })

  it('findActiveGroupにはaccountIdとexternalGroupId(channelId)が渡る', async () => {
    const findActiveGroup = vi.fn().mockResolvedValue(null)
    const deps = makeDeps({ findActiveGroup })
    await handleTeamsWebhook(activity(), deps)
    expect(findActiveGroup).toHaveBeenCalledWith('acc-teams-plat', '19:abcd1234@thread.tacv2')
  })
})

describe('handleTeamsWebhook — limbo（未claim）', () => {
  it('合言葉でない通常発言は完全沈黙（無返信）', async () => {
    const deps = makeDeps({ normalizeClaimCode: vi.fn().mockReturnValue(null) })
    await handleTeamsWebhook(activity(), deps)
    expect(deps.reply).not.toHaveBeenCalled()
  })

  it('textがnull（非stringだった）場合も沈黙', async () => {
    const deps = makeDeps()
    await handleTeamsWebhook(activity({ text: null }), deps)
    expect(deps.normalizeClaimCode).not.toHaveBeenCalled()
    expect(deps.reply).not.toHaveBeenCalled()
  })

  it('無効コードは INVALID_TEXT を返信（レート未超過）', async () => {
    const deps = makeDeps({
      normalizeClaimCode: vi.fn().mockReturnValue('CODE26'),
      findValidClaimCode: vi.fn().mockResolvedValue(null),
      registerInvalidAttempt: vi.fn().mockReturnValue(false),
    })
    await handleTeamsWebhook(activity({ text: 'GC-XXXX' }), deps)
    expect(deps.reply).toHaveBeenCalledWith(INVALID_TEXT)
  })

  it('無効コード×レート超過は無返信', async () => {
    const deps = makeDeps({
      normalizeClaimCode: vi.fn().mockReturnValue('CODE26'),
      findValidClaimCode: vi.fn().mockResolvedValue(null),
      registerInvalidAttempt: vi.fn().mockReturnValue(true),
    })
    await handleTeamsWebhook(activity({ text: 'GC-XXXX' }), deps)
    expect(deps.reply).not.toHaveBeenCalled()
  })

  it('code_only 有効コード×Pro: 即時償還してLINKED文言を返信し、maxActiveGroupsが渡る', async () => {
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
    await handleTeamsWebhook(activity({ text: 'GC-CODE' }), deps)
    expect(deps.redeemCodeOnly).toHaveBeenCalledWith(
      'hash(CODE26)',
      'acc-teams-plat',
      '19:abcd1234@thread.tacv2',
      null,
      50,
    )
    expect(deps.reply).toHaveBeenCalledWith(CODE_ONLY_LINKED_TEXT)
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
    await handleTeamsWebhook(activity({ text: 'GC-CODE' }), deps)
    expect(deps.reply).toHaveBeenCalledWith(CODE_ONLY_ALREADY_TEXT)
  })

  it('web_approval 有効コード×Pro: pending claim作成＋確認番号を返信', async () => {
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
    await handleTeamsWebhook(activity({ text: 'GC-CODE' }), deps)
    expect(createPendingClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        linkCodeId: 'lc-1',
        accountId: 'acc-teams-plat',
        externalGroupId: '19:abcd1234@thread.tacv2',
        orgId: 'org-1',
        spaceId: 'space-1',
        challengeLabel: 'AB12',
      }),
    )
    expect(deps.reply).toHaveBeenCalledWith(buildAcceptedText('AB12'))
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
    await handleTeamsWebhook(activity({ text: 'GC-CODE' }), deps)
    expect(createPendingClaim).not.toHaveBeenCalled()
    expect(deps.reply).toHaveBeenCalledWith(INVALID_TEXT)
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
    await handleTeamsWebhook(activity({ text: 'GC-CODE' }), deps)
    expect(deps.reply).toHaveBeenCalledWith(INVALID_TEXT)
  })
})
