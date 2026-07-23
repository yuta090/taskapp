import { describe, it, expect, vi } from 'vitest'
import {
  processClaimLimbo,
  runDigestCompletion,
  INVALID_TEXT,
  CODE_ONLY_LINKED_TEXT,
  CODE_ONLY_ALREADY_TEXT,
  buildAcceptedText,
  ALREADY_DONE_TEXT,
  buildDigestDoneText,
  type ClaimLimboDeps,
  type DigestCompletionDeps,
} from '@/lib/channels/claimLimboCore'

function makeClaimDeps(over: Partial<ClaimLimboDeps> = {}): ClaimLimboDeps {
  return {
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

describe('processClaimLimbo', () => {
  it('本文なし(null)は完全沈黙', async () => {
    const deps = makeClaimDeps()
    const res = await processClaimLimbo({ accountId: 'acc-1', externalGroupId: 'G1', text: null }, deps)
    expect(res).toEqual({ claimCreated: false })
    expect(deps.normalizeClaimCode).not.toHaveBeenCalled()
    expect(deps.reply).not.toHaveBeenCalled()
  })

  it('本文が空文字は完全沈黙', async () => {
    const deps = makeClaimDeps()
    const res = await processClaimLimbo({ accountId: 'acc-1', externalGroupId: 'G1', text: '' }, deps)
    expect(res).toEqual({ claimCreated: false })
    expect(deps.reply).not.toHaveBeenCalled()
  })

  it('コード正準形でない通常発言は完全沈黙（無返信）', async () => {
    const deps = makeClaimDeps({ normalizeClaimCode: vi.fn().mockReturnValue(null) })
    const res = await processClaimLimbo(
      { accountId: 'acc-1', externalGroupId: 'G1', text: 'こんにちは' },
      deps,
    )
    expect(res).toEqual({ claimCreated: false })
    expect(deps.reply).not.toHaveBeenCalled()
    expect(deps.findValidClaimCode).not.toHaveBeenCalled()
  })

  it('コード不一致は固定文言を返信（レート未超過）', async () => {
    const deps = makeClaimDeps({
      normalizeClaimCode: vi.fn().mockReturnValue('CODE26'),
      findValidClaimCode: vi.fn().mockResolvedValue(null),
      registerInvalidAttempt: vi.fn().mockReturnValue(false),
    })
    const res = await processClaimLimbo(
      { accountId: 'acc-1', externalGroupId: 'G1', text: 'GC-XXXX' },
      deps,
    )
    expect(res).toEqual({ claimCreated: false })
    expect(deps.reply).toHaveBeenCalledWith(INVALID_TEXT)
  })

  it('コード不一致でもレート超過後は無返信', async () => {
    const deps = makeClaimDeps({
      normalizeClaimCode: vi.fn().mockReturnValue('CODE26'),
      findValidClaimCode: vi.fn().mockResolvedValue(null),
      registerInvalidAttempt: vi.fn().mockReturnValue(true),
    })
    await processClaimLimbo({ accountId: 'acc-1', externalGroupId: 'G1', text: 'GC-XXXX' }, deps)
    expect(deps.reply).not.toHaveBeenCalled()
  })

  it('entitle無(hasExternalChatChannels=false)は確立させず無効文言（漏らさない）', async () => {
    const createPendingClaim = vi.fn()
    const deps = makeClaimDeps({
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
    const res = await processClaimLimbo({ accountId: 'acc-1', externalGroupId: 'G1', text: 'GC-CODE' }, deps)
    expect(res).toEqual({ claimCreated: false })
    expect(createPendingClaim).not.toHaveBeenCalled()
    expect(deps.reply).toHaveBeenCalledWith(INVALID_TEXT)
  })

  it('容量超過(activeCount>=max)は確立させず無効文言', async () => {
    const deps = makeClaimDeps({
      normalizeClaimCode: vi.fn().mockReturnValue('CODE26'),
      findValidClaimCode: vi.fn().mockResolvedValue({
        id: 'lc-1',
        orgId: 'org-1',
        spaceId: 'space-1',
        bindingMode: 'web_approval',
      }),
      externalChatGroupCapacity: vi.fn().mockResolvedValue({ activeCount: 50, max: 50 }),
      createPendingClaim: vi.fn(),
    })
    const res = await processClaimLimbo({ accountId: 'acc-1', externalGroupId: 'G1', text: 'GC-CODE' }, deps)
    expect(res).toEqual({ claimCreated: false })
    expect(deps.reply).toHaveBeenCalledWith(INVALID_TEXT)
  })

  it('code_only: 償還linkedは登録文言で応答しclaimCreated=true', async () => {
    const deps = makeClaimDeps({
      normalizeClaimCode: vi.fn().mockReturnValue('CODE26'),
      findValidClaimCode: vi.fn().mockResolvedValue({
        id: 'lc-1',
        orgId: 'org-1',
        spaceId: 'space-1',
        bindingMode: 'code_only',
      }),
      redeemCodeOnly: vi.fn().mockResolvedValue('linked'),
    })
    const res = await processClaimLimbo({ accountId: 'acc-1', externalGroupId: 'G1', text: 'GC-CODE' }, deps)
    expect(res).toEqual({ claimCreated: true })
    expect(deps.redeemCodeOnly).toHaveBeenCalledWith('hash(CODE26)', 'acc-1', 'G1', null, 50)
    expect(deps.reply).toHaveBeenCalledWith(CODE_ONLY_LINKED_TEXT)
  })

  it('code_only: 償還already_linkedは既登録文言で応答しclaimCreated=false', async () => {
    const deps = makeClaimDeps({
      normalizeClaimCode: vi.fn().mockReturnValue('CODE26'),
      findValidClaimCode: vi.fn().mockResolvedValue({
        id: 'lc-1',
        orgId: 'org-1',
        spaceId: 'space-1',
        bindingMode: 'code_only',
      }),
      redeemCodeOnly: vi.fn().mockResolvedValue('already_linked'),
    })
    const res = await processClaimLimbo({ accountId: 'acc-1', externalGroupId: 'G1', text: 'GC-CODE' }, deps)
    expect(res).toEqual({ claimCreated: false })
    expect(deps.reply).toHaveBeenCalledWith(CODE_ONLY_ALREADY_TEXT)
  })

  it('code_only: 償還rejectedは無効文言で応答しclaimCreated=false', async () => {
    const deps = makeClaimDeps({
      normalizeClaimCode: vi.fn().mockReturnValue('CODE26'),
      findValidClaimCode: vi.fn().mockResolvedValue({
        id: 'lc-1',
        orgId: 'org-1',
        spaceId: 'space-1',
        bindingMode: 'code_only',
      }),
      redeemCodeOnly: vi.fn().mockResolvedValue('rejected'),
    })
    const res = await processClaimLimbo({ accountId: 'acc-1', externalGroupId: 'G1', text: 'GC-CODE' }, deps)
    expect(res).toEqual({ claimCreated: false })
    expect(deps.reply).toHaveBeenCalledWith(INVALID_TEXT)
  })

  it('web_approval: pending claim 作成＋確認番号を含む受理文言で応答', async () => {
    const createPendingClaim = vi.fn().mockResolvedValue({ challengeLabel: 'AB12' })
    const deps = makeClaimDeps({
      normalizeClaimCode: vi.fn().mockReturnValue('CODE26'),
      findValidClaimCode: vi.fn().mockResolvedValue({
        id: 'lc-1',
        orgId: 'org-1',
        spaceId: 'space-1',
        bindingMode: 'web_approval',
      }),
      createPendingClaim,
    })
    const res = await processClaimLimbo({ accountId: 'acc-1', externalGroupId: 'G1', text: 'GC-CODE' }, deps)
    expect(res).toEqual({ claimCreated: true })
    expect(createPendingClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        linkCodeId: 'lc-1',
        accountId: 'acc-1',
        externalGroupId: 'G1',
        orgId: 'org-1',
        spaceId: 'space-1',
        challengeLabel: 'AB12',
      }),
    )
    expect(deps.reply).toHaveBeenCalledWith(buildAcceptedText('AB12'))
  })

  it('enterprise(max=null)は容量で弾かれない', async () => {
    const deps = makeClaimDeps({
      normalizeClaimCode: vi.fn().mockReturnValue('CODE26'),
      findValidClaimCode: vi.fn().mockResolvedValue({
        id: 'lc-1',
        orgId: 'org-1',
        spaceId: 'space-1',
        bindingMode: 'web_approval',
      }),
      externalChatGroupCapacity: vi.fn().mockResolvedValue({ activeCount: 999, max: null }),
    })
    const res = await processClaimLimbo({ accountId: 'acc-1', externalGroupId: 'G1', text: 'GC-CODE' }, deps)
    expect(res).toEqual({ claimCreated: true })
  })
})

describe('runDigestCompletion', () => {
  function makeDigestDeps(over: Partial<DigestCompletionDeps<'discord'>> = {}): DigestCompletionDeps<'discord'> {
    return {
      completeDigestTask: vi.fn().mockResolvedValue(null),
      reply: vi.fn().mockResolvedValue({ providerMessageId: null }),
      insertOutbound: vi.fn().mockResolvedValue(undefined),
      ...over,
    }
  }

  it('完了できた場合は完了文言でreplyし、insertOutboundにprovider_message_idを含めて記録する', async () => {
    const completeDigestTask = vi.fn().mockResolvedValue({ id: 'task-1', title: '見積書の送付' })
    const reply = vi.fn().mockResolvedValue({ providerMessageId: 'prov-1' })
    const insertOutbound = vi.fn().mockResolvedValue(undefined)
    const deps = makeDigestDeps({ completeDigestTask, reply, insertOutbound })

    await runDigestCompletion(
      {
        orgId: 'org-1',
        spaceId: 'space-1',
        accountId: 'acc-1',
        groupId: 'grp-1',
        channel: 'discord',
        externalUserId: 'U1',
        autoReplyTo: 'M1',
      },
      1,
      deps,
    )

    expect(completeDigestTask).toHaveBeenCalledWith('grp-1', 1, 'U1')
    expect(reply).toHaveBeenCalledWith(buildDigestDoneText('見積書の送付'))
    expect(insertOutbound).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-1',
        spaceId: 'space-1',
        accountId: 'acc-1',
        groupId: 'grp-1',
        channel: 'discord',
        direction: 'outbound',
        actor: 'secretary',
        body: buildDigestDoneText('見積書の送付'),
        status: 'sent',
        error: null,
        payload: expect.objectContaining({ autoReplyTo: 'M1', provider_message_id: 'prov-1' }),
      }),
    )
  })

  it('該当タスクが無い場合はALREADY_DONE_TEXTでreplyする', async () => {
    const reply = vi.fn().mockResolvedValue({ providerMessageId: null })
    const deps = makeDigestDeps({ completeDigestTask: vi.fn().mockResolvedValue(null), reply })

    await runDigestCompletion(
      {
        orgId: 'org-1',
        spaceId: 'space-1',
        accountId: 'acc-1',
        groupId: 'grp-1',
        channel: 'discord',
        externalUserId: 'U1',
        autoReplyTo: 'M1',
      },
      2,
      deps,
    )

    expect(reply).toHaveBeenCalledWith(ALREADY_DONE_TEXT)
  })
})
