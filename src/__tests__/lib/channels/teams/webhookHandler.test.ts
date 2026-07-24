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

const GROUP = { id: 'grp-1', orgId: 'org-1', spaceId: 'space-1' }

function makeDeps(over: Partial<TeamsWebhookDeps> = {}): TeamsWebhookDeps {
  return {
    loadPlatformAccount: vi.fn().mockResolvedValue(ACCOUNT),
    findActiveGroup: vi.fn().mockResolvedValue(null),
    insertMessage: vi.fn().mockResolvedValue({ id: 'msg-1' }),
    completeDigestTask: vi.fn().mockResolvedValue({ id: 'task-1', title: 'タスクA' }),
    insertOutbound: vi.fn().mockResolvedValue({ id: 'out-1' }),
    updateGroupMetadata: vi.fn().mockResolvedValue(undefined),
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
  it('claimed（findActiveGroup有）はlimbo系のdepsを一切呼ばない（claim/limboとの二重処理防止）', async () => {
    const deps = makeDeps({ findActiveGroup: vi.fn().mockResolvedValue(GROUP) })
    await handleTeamsWebhook(activity({ text: 'GC-XXXX' }), deps)
    expect(deps.normalizeClaimCode).not.toHaveBeenCalled()
    expect(deps.findValidClaimCode).not.toHaveBeenCalled()
  })

  it('findActiveGroupにはaccountIdとexternalGroupId(channelId)が渡る', async () => {
    const findActiveGroup = vi.fn().mockResolvedValue(null)
    const deps = makeDeps({ findActiveGroup })
    await handleTeamsWebhook(activity(), deps)
    expect(findActiveGroup).toHaveBeenCalledWith('acc-teams-plat', '19:abcd1234@thread.tacv2')
  })

  it('通常発言は insertMessage で group_id 付き・正しい dedupe 値で記録される', async () => {
    const insertMessage = vi.fn().mockResolvedValue({ id: 'msg-1' })
    const deps = makeDeps({ findActiveGroup: vi.fn().mockResolvedValue(GROUP), insertMessage })
    await handleTeamsWebhook(activity({ text: 'こんにちは', activityId: 'act-42' }), deps)
    expect(insertMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-1',
        spaceId: 'space-1',
        identityId: null,
        accountId: 'acc-teams-plat',
        groupId: 'grp-1',
        channel: 'teams',
        direction: 'inbound',
        actor: 'client',
        externalUserId: '29:user-1',
        externalMessageId: '19:abcd1234@thread.tacv2:act-42',
        body: 'こんにちは',
        occurredAt: '2026-07-24T00:00:00.000Z',
      }),
    )
  })

  it('duplicate（webhook再送）は以降の完了処理を一切しない', async () => {
    const completeDigestTask = vi.fn()
    const deps = makeDeps({
      findActiveGroup: vi.fn().mockResolvedValue(GROUP),
      insertMessage: vi.fn().mockResolvedValue('duplicate'),
      completeDigestTask,
    })
    await handleTeamsWebhook(activity({ text: '完了3' }), deps)
    expect(completeDigestTask).not.toHaveBeenCalled()
    expect(deps.reply).not.toHaveBeenCalled()
  })

  it('【PR-2レビュー是正】duplicate（webhook再送）は updateGroupMetadata も呼ばない（無駄なselect+updateを避ける）', async () => {
    const updateGroupMetadata = vi.fn().mockResolvedValue(undefined)
    const deps = makeDeps({
      findActiveGroup: vi.fn().mockResolvedValue(GROUP),
      insertMessage: vi.fn().mockResolvedValue('duplicate'),
      updateGroupMetadata,
    })
    await handleTeamsWebhook(activity({ text: '完了3' }), deps)
    expect(updateGroupMetadata).not.toHaveBeenCalled()
  })

  it('【PR-2レビュー是正】claimedグループでもBot発言（isBot:true）は記録も完了もされない（多層防御の回帰）', async () => {
    const insertMessage = vi.fn().mockResolvedValue({ id: 'msg-1' })
    const completeDigestTask = vi.fn()
    const deps = makeDeps({
      findActiveGroup: vi.fn().mockResolvedValue(GROUP),
      insertMessage,
      completeDigestTask,
    })
    await handleTeamsWebhook(activity({ isBot: true, text: '完了3' }), deps)
    expect(deps.findActiveGroup).not.toHaveBeenCalled()
    expect(insertMessage).not.toHaveBeenCalled()
    expect(completeDigestTask).not.toHaveBeenCalled()
    expect(deps.reply).not.toHaveBeenCalled()
  })

  it('「完了3」は申し送りタスクを完了して返信・outbound記録する', async () => {
    const completeDigestTask = vi.fn().mockResolvedValue({ id: 'task-1', title: 'タスクA' })
    const insertOutbound = vi.fn().mockResolvedValue({ id: 'out-1' })
    const reply = vi.fn().mockResolvedValue(undefined)
    const deps = makeDeps({
      findActiveGroup: vi.fn().mockResolvedValue(GROUP),
      completeDigestTask,
      insertOutbound,
      reply,
    })
    await handleTeamsWebhook(activity({ text: '完了3', activityId: 'act-42' }), deps)
    expect(completeDigestTask).toHaveBeenCalledWith('grp-1', 3, '29:user-1')
    expect(reply).toHaveBeenCalledTimes(1)
    expect(insertOutbound).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-1',
        spaceId: 'space-1',
        accountId: 'acc-teams-plat',
        groupId: 'grp-1',
        channel: 'teams',
        direction: 'outbound',
        actor: 'secretary',
        payload: expect.objectContaining({ autoReplyTo: '19:abcd1234@thread.tacv2:act-42' }),
      }),
    )
  })

  it('mention除去後のテキスト（activity.text。剥がすのはactivity.ts側）が「完了N」ならそのまま発火する', async () => {
    // activity.ts の normalizeTeamsActivity が mention を既に剥がした後の text がここに届く前提
    // （stripTeamsMentionの単体網羅は activity.test.ts）。ここでは「剥がされた後の文字列」を
    // 厳格文法にそのまま渡して発火することだけを確認する（誤爆防止の境界確認）。
    const completeDigestTask = vi.fn().mockResolvedValue({ id: 'task-1', title: 'タスクA' })
    const deps = makeDeps({ findActiveGroup: vi.fn().mockResolvedValue(GROUP), completeDigestTask })
    await handleTeamsWebhook(activity({ text: '完了3' }), deps)
    expect(completeDigestTask).toHaveBeenCalledWith('grp-1', 3, '29:user-1')
  })

  it('自然文（"完了しました"等）は完了コマンドとして発火しない（誤爆防止）', async () => {
    const completeDigestTask = vi.fn()
    const deps = makeDeps({ findActiveGroup: vi.fn().mockResolvedValue(GROUP), completeDigestTask })
    await handleTeamsWebhook(activity({ text: '完了しました' }), deps)
    expect(completeDigestTask).not.toHaveBeenCalled()
    expect(deps.reply).not.toHaveBeenCalled()
  })

  it('textがnullでも記録・metadata更新はされるが完了処理はしない', async () => {
    const insertMessage = vi.fn().mockResolvedValue({ id: 'msg-1' })
    const completeDigestTask = vi.fn()
    const deps = makeDeps({
      findActiveGroup: vi.fn().mockResolvedValue(GROUP),
      insertMessage,
      completeDigestTask,
    })
    await handleTeamsWebhook(activity({ text: null }), deps)
    expect(insertMessage).toHaveBeenCalledWith(expect.objectContaining({ body: null }))
    expect(completeDigestTask).not.toHaveBeenCalled()
  })

  it('serviceUrl/teamId/tenantId が updateGroupMetadata に渡る', async () => {
    const updateGroupMetadata = vi.fn().mockResolvedValue(undefined)
    const deps = makeDeps({ findActiveGroup: vi.fn().mockResolvedValue(GROUP), updateGroupMetadata })
    await handleTeamsWebhook(
      activity({
        serviceUrl: 'https://smba.trafficmanager.net/amer/',
        teamId: '19:team-abc@thread.tacv2',
        tenantId: 'tenant-1',
      }),
      deps,
    )
    expect(updateGroupMetadata).toHaveBeenCalledWith('grp-1', {
      serviceUrl: 'https://smba.trafficmanager.net/amer/',
      teamId: '19:team-abc@thread.tacv2',
      tenantId: 'tenant-1',
    })
  })

  it('serviceUrl等が全て無ければ updateGroupMetadata を呼ばない（空更新で既存metadataを壊さない）', async () => {
    const updateGroupMetadata = vi.fn().mockResolvedValue(undefined)
    const deps = makeDeps({ findActiveGroup: vi.fn().mockResolvedValue(GROUP), updateGroupMetadata })
    await handleTeamsWebhook(
      activity({ serviceUrl: null, teamId: null, tenantId: null }),
      deps,
    )
    expect(updateGroupMetadata).not.toHaveBeenCalled()
  })

  it('updateGroupMetadataが失敗しても記録・完了処理は継続する（best-effort・沈黙が保たれる）', async () => {
    const updateGroupMetadata = vi.fn().mockRejectedValue(new Error('db down'))
    const completeDigestTask = vi.fn().mockResolvedValue({ id: 'task-1', title: 'タスクA' })
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const deps = makeDeps({
      findActiveGroup: vi.fn().mockResolvedValue(GROUP),
      updateGroupMetadata,
      completeDigestTask,
    })
    await expect(handleTeamsWebhook(activity({ text: '完了3' }), deps)).resolves.toBeUndefined()
    expect(completeDigestTask).toHaveBeenCalledWith('grp-1', 3, '29:user-1')
    consoleErrorSpy.mockRestore()
  })

  it('replyが失敗（例外を投げない設計）でも記録は既に残っている（沈黙が保たれる）', async () => {
    const insertMessage = vi.fn().mockResolvedValue({ id: 'msg-1' })
    const reply = vi.fn().mockResolvedValue(undefined) // connectorClient.sendTeamsReplyはbest-effortで例外を投げない設計
    const deps = makeDeps({ findActiveGroup: vi.fn().mockResolvedValue(GROUP), insertMessage, reply })
    await handleTeamsWebhook(activity({ text: '完了3' }), deps)
    expect(insertMessage).toHaveBeenCalledTimes(1)
    expect(reply).toHaveBeenCalledTimes(1)
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
