import { describe, it, expect } from 'vitest'
import {
  normalizeTeamsActivity,
  stripTeamsMention,
  type TeamsActivity,
} from '@/lib/channels/teams/activity'

function baseActivity(over: Partial<TeamsActivity> = {}): TeamsActivity {
  return {
    type: 'message',
    id: '1234567890',
    text: 'こんにちは',
    timestamp: '2026-07-24T00:00:00.000Z',
    serviceUrl: 'https://smba.trafficmanager.net/amer/',
    channelData: {
      channel: { id: '19:abcd1234@thread.tacv2' },
      team: { id: '19:team-abc@thread.tacv2' },
      tenant: { id: 'tenant-1' },
    },
    conversation: { id: '19:abcd1234@thread.tacv2;messageid=1234567890' },
    from: { id: '29:user-1' },
    recipient: { id: '28:bot-1' },
    ...over,
  }
}

describe('normalizeTeamsActivity', () => {
  it('type=message以外はnull（conversationUpdate等を入口で弾く）', () => {
    expect(normalizeTeamsActivity(baseActivity({ type: 'conversationUpdate' }))).toBeNull()
  })

  it('channelData.channel.idをexternalGroupIdとして採用する', () => {
    const result = normalizeTeamsActivity(baseActivity())
    expect(result?.externalGroupId).toBe('19:abcd1234@thread.tacv2')
  })

  it('channelData.channel.id欠落時はconversation.idの;messageid=より前をフォールバックに使う', () => {
    const result = normalizeTeamsActivity(
      baseActivity({
        channelData: { team: { id: 't1' }, tenant: { id: 'ten1' } },
        conversation: { id: '19:xyz789@thread.tacv2;messageid=999' },
      }),
    )
    expect(result?.externalGroupId).toBe('19:xyz789@thread.tacv2')
  })

  it('channelData.channel.idもconversation.idも無ければnull', () => {
    const result = normalizeTeamsActivity(
      baseActivity({ channelData: undefined, conversation: undefined }),
    )
    expect(result).toBeNull()
  })

  it('conversationIdは正規化後もそのまま(;messageid=込み)で残す（Connector返信先用）', () => {
    const result = normalizeTeamsActivity(baseActivity())
    expect(result?.conversationId).toBe('19:abcd1234@thread.tacv2;messageid=1234567890')
  })

  it('from.idが28:prefixならisBot:true', () => {
    const result = normalizeTeamsActivity(baseActivity({ from: { id: '28:other-bot' } }))
    expect(result?.isBot).toBe(true)
  })

  it('from.idが29:prefix（人間ユーザー）ならisBot:false', () => {
    const result = normalizeTeamsActivity(baseActivity({ from: { id: '29:user-1' } }))
    expect(result?.isBot).toBe(false)
  })

  it('textがstringでなければnull（コードになり得ず沈黙）', () => {
    const result = normalizeTeamsActivity(baseActivity({ text: undefined }))
    expect(result?.text).toBeNull()
  })

  it('mention除去: 自分宛メンションのタグを本文から取り除く', () => {
    const result = normalizeTeamsActivity(
      baseActivity({
        text: '<at>Bot</at> GC-CODE1234',
        entities: [{ type: 'mention', text: '<at>Bot</at>', mentioned: { id: '28:bot-1' } }],
        recipient: { id: '28:bot-1' },
      }),
    )
    expect(result?.text).toBe(' GC-CODE1234')
  })

  it('serviceUrl/teamId/tenantId/occurredAtをそのまま返す', () => {
    const result = normalizeTeamsActivity(baseActivity())
    expect(result).toMatchObject({
      serviceUrl: 'https://smba.trafficmanager.net/amer/',
      teamId: '19:team-abc@thread.tacv2',
      tenantId: 'tenant-1',
      occurredAt: '2026-07-24T00:00:00.000Z',
    })
  })

  it('timestamp欠落時はnew Date(0).toISOString()にフォールバックする', () => {
    const result = normalizeTeamsActivity(baseActivity({ timestamp: undefined }))
    expect(result?.occurredAt).toBe(new Date(0).toISOString())
  })

  it('externalUserIdはfrom.id', () => {
    const result = normalizeTeamsActivity(baseActivity())
    expect(result?.externalUserId).toBe('29:user-1')
  })

  it('id（activityId）が欠落した message は null（PR-2レビュー是正: dedupeキーの安定生成不能）', () => {
    const result = normalizeTeamsActivity(baseActivity({ id: undefined }))
    expect(result).toBeNull()
  })

  it('idが空文字のmessageもnull', () => {
    const result = normalizeTeamsActivity(baseActivity({ id: '' }))
    expect(result).toBeNull()
  })
})

describe('stripTeamsMention', () => {
  it('他人宛メンション（mentioned.id不一致）は剥がさない', () => {
    const text = stripTeamsMention('<at>Other</at> hello', [
      { type: 'mention', text: '<at>Other</at>', mentioned: { id: '28:other' } },
    ], '28:bot-1')
    expect(text).toBe('<at>Other</at> hello')
  })

  it('entities未指定は無加工', () => {
    expect(stripTeamsMention('hello', undefined, '28:bot-1')).toBe('hello')
  })

  it('recipientId未指定は無加工', () => {
    expect(
      stripTeamsMention(
        '<at>Bot</at> hello',
        [{ type: 'mention', text: '<at>Bot</at>', mentioned: { id: '28:bot-1' } }],
        undefined,
      ),
    ).toBe('<at>Bot</at> hello')
  })

  it('文中の複数箇所のメンションも全て取り除く', () => {
    const text = stripTeamsMention(
      '<at>Bot</at> hi <at>Bot</at>',
      [{ type: 'mention', text: '<at>Bot</at>', mentioned: { id: '28:bot-1' } }],
      '28:bot-1',
    )
    expect(text).toBe(' hi ')
  })
})
