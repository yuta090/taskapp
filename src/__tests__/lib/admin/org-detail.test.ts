import { describe, it, expect } from 'vitest'
import {
  buildOrgDetail,
  getOrgRoleLabel,
  getBillingStatusLabel,
  getSharedBotAccessLabel,
  getIntegrationProviderLabel,
  getIntegrationStatusLabel,
  type OrgDetailInput,
} from '@/lib/admin/org-detail'

const NOW = new Date('2026-09-06T10:00:00+09:00').getTime()

function baseInput(overrides: Partial<OrgDetailInput> = {}): OrgDetailInput {
  return {
    org: { id: 'org-1', name: 'テスト事務所', created_at: '2026-01-10T00:00:00+09:00' },
    memberships: [
      { user_id: 'u-member', role: 'member', created_at: '2026-02-01T00:00:00+09:00' },
      { user_id: 'u-owner', role: 'owner', created_at: '2026-01-10T00:00:00+09:00' },
      { user_id: 'u-client', role: 'client', created_at: '2026-03-01T00:00:00+09:00' },
    ],
    profiles: [
      { id: 'u-owner', display_name: '高橋', is_superadmin: true },
      { id: 'u-member', display_name: null, is_superadmin: false },
    ],
    emails: new Map([
      ['u-owner', 'owner@example.com'],
      ['u-member', 'member@example.com'],
    ]),
    spaces: [
      { id: 's-1', name: '案件A', type: 'project', archived_at: null, created_at: '2026-01-11T00:00:00+09:00' },
      { id: 's-2', name: '古い案件', type: 'project', archived_at: '2026-05-01T00:00:00+09:00', created_at: '2026-01-12T00:00:00+09:00' },
      { id: 's-3', name: '個人', type: 'personal', archived_at: null, created_at: '2026-01-13T00:00:00+09:00' },
    ],
    taskCounts: { total: 3, open: 2, bySpace: { 's-1': 2, 's-2': 1 } },
    spaceMemberships: [
      { space_id: 's-1' },
      { space_id: 's-1' },
      { space_id: 's-3' },
    ],
    billing: { plan_id: 'pro', status: 'active', current_period_end: '2026-10-01T00:00:00+09:00', cancel_at_period_end: false, stripe_customer_id: 'cus_x', stripe_subscription_id: 'sub_x' },
    policy: { shared_bot_access: 'granted', shared_bot_access_requested_at: '2026-02-01T00:00:00+09:00', shared_bot_access_granted_at: '2026-02-02T00:00:00+09:00', state: 'ok' },
    channelGroups: [
      { id: 'g-1', channel: 'line', space_id: 's-1', display_name: null, external_group_id: 'Cabc123', status: 'active', joined_at: '2026-02-03T00:00:00+09:00' },
      { id: 'g-2', channel: 'slack', space_id: null, display_name: '#general', external_group_id: 'C999', status: 'left', joined_at: '2026-02-04T00:00:00+09:00' },
    ],
    integrations: [
      { id: 'i-1', provider: 'google_tasks', owner_type: 'org', status: 'active', import_enabled: true, created_at: '2026-02-05T00:00:00+09:00' },
      { id: 'i-2', provider: 'mystery', owner_type: 'user', status: 'weird', import_enabled: false, created_at: '2026-02-06T00:00:00+09:00' },
    ],
    invites: [
      { id: 'inv-1', email: 'new@example.com', role: 'member', space_id: 's-1', expires_at: '2026-12-31T00:00:00+09:00', accepted_at: null },
      { id: 'inv-2', email: 'old@example.com', role: 'client', space_id: 's-1', expires_at: '2026-01-01T00:00:00+09:00', accepted_at: null },
      { id: 'inv-3', email: 'done@example.com', role: 'member', space_id: 's-1', expires_at: '2026-12-31T00:00:00+09:00', accepted_at: '2026-02-01T00:00:00+09:00' },
    ],
    notifications: [
      { id: 'n-1', type: 'review_request', channel: 'in_app', created_at: '2026-09-05T00:00:00+09:00', read_at: null },
      { id: 'n-2', type: 'unknown_type', channel: 'line', created_at: '2026-09-04T00:00:00+09:00', read_at: '2026-09-04T01:00:00+09:00' },
    ],
    apiKeyCount: 2,
    nowMs: NOW,
    ...overrides,
  }
}

describe('ラベル', () => {
  it('組織内の役割を日本語にする（UIの言葉: 相手先）', () => {
    expect(getOrgRoleLabel('owner')).toBe('オーナー')
    expect(getOrgRoleLabel('member')).toBe('メンバー')
    expect(getOrgRoleLabel('client')).toBe('相手先')
    expect(getOrgRoleLabel('???')).toBe('???')
  })

  it('課金ステータス・共通LINE開通・連携の状態を日本語にする', () => {
    expect(getBillingStatusLabel('active')).toBe('有効')
    expect(getBillingStatusLabel('past_due')).toBe('支払い遅延')
    expect(getBillingStatusLabel('')).toBe('未設定')
    expect(getSharedBotAccessLabel('requested')).toBe('申込中（開通待ち）')
    expect(getSharedBotAccessLabel('none')).toBe('未申込')
    expect(getIntegrationProviderLabel('google_tasks')).toBe('Google Tasks')
    expect(getIntegrationProviderLabel('mystery')).toBe('mystery')
    expect(getIntegrationStatusLabel('expired')).toBe('期限切れ')
    expect(getIntegrationStatusLabel('weird')).toBe('weird')
  })
})

describe('buildOrgDetail', () => {
  it('基本情報とプランをまとめる', () => {
    const d = buildOrgDetail(baseInput())
    expect(d.id).toBe('org-1')
    expect(d.name).toBe('テスト事務所')
    expect(d.billing.planId).toBe('pro')
    expect(d.billing.planLabel).toBe('Pro')
    expect(d.billing.status).toBe('active')
    expect(d.billing.statusLabel).toBe('有効')
    expect(d.billing.currentPeriodEnd).toBe('2026-10-01T00:00:00+09:00')
  })

  it('課金行が無ければ free / 未設定 扱いにする', () => {
    const d = buildOrgDetail(baseInput({ billing: null }))
    expect(d.billing.planId).toBe('free')
    expect(d.billing.planLabel).toBe('Free')
    expect(d.billing.statusLabel).toBe('未設定')
  })

  it('メンバーは profile とメールを合成し、オーナー→メンバー→相手先の順に並ぶ', () => {
    const d = buildOrgDetail(baseInput())
    expect(d.members.map((m) => m.userId)).toEqual(['u-owner', 'u-member', 'u-client'])
    const owner = d.members[0]
    expect(owner.displayName).toBe('高橋')
    expect(owner.email).toBe('owner@example.com')
    expect(owner.roleLabel).toBe('オーナー')
    expect(owner.isSuperadmin).toBe(true)
    // profile が無いユーザーでも落ちず、名前・メールは空で返す
    const client = d.members[2]
    expect(client.displayName).toBeNull()
    expect(client.email).toBe('')
    expect(client.isSuperadmin).toBe(false)
  })

  it('スペースごとのメンバー数・タスク数を数え、アーカイブ済みを区別する', () => {
    const d = buildOrgDetail(baseInput())
    const s1 = d.spaces.find((s) => s.id === 's-1')!
    expect(s1.memberCount).toBe(2)
    expect(s1.taskCount).toBe(2)
    expect(s1.isArchived).toBe(false)
    const s2 = d.spaces.find((s) => s.id === 's-2')!
    expect(s2.isArchived).toBe(true)
    expect(s2.taskCount).toBe(1)
    // 稼働中が先、アーカイブ済みは後ろ
    expect(d.spaces[d.spaces.length - 1].id).toBe('s-2')
  })

  it('概要の数字（メンバー・稼働スペース・アーカイブ・タスク・連携）を出す', () => {
    const d = buildOrgDetail(baseInput())
    expect(d.stats).toEqual({
      memberCount: 3,
      activeSpaceCount: 2,
      archivedSpaceCount: 1,
      taskCount: 3,
      openTaskCount: 2,
      channelGroupCount: 1, // 退出済みは数えない
      integrationCount: 1, // active のみ
      apiKeyCount: 2,
      pendingInviteCount: 1,
    })
  })

  it('共通LINEの開通状態とチャットグループ（表示名の代替・紐づくスペース名）を出す', () => {
    const d = buildOrgDetail(baseInput())
    expect(d.sharedBot.status).toBe('granted')
    expect(d.sharedBot.label).toBe('開通済み')
    expect(d.sharedBot.grantedAt).toBe('2026-02-02T00:00:00+09:00')
    const g1 = d.channelGroups.find((g) => g.id === 'g-1')!
    expect(g1.channelLabel).toBe('LINE')
    expect(g1.displayName).toBe('Cabc123')
    expect(g1.spaceName).toBe('案件A')
    expect(g1.statusLabel).toBe('参加中')
    const g2 = d.channelGroups.find((g) => g.id === 'g-2')!
    expect(g2.channelLabel).toBe('Slack')
    expect(g2.spaceName).toBeNull()
    expect(g2.statusLabel).toBe('退出済み')
  })

  it('org_channel_policy が無ければ 未申込 扱いにする', () => {
    const d = buildOrgDetail(baseInput({ policy: null }))
    expect(d.sharedBot.status).toBe('none')
    expect(d.sharedBot.label).toBe('未申込')
  })

  it('ツール連携は日本語名と状態を付け、未知の値はそのまま出す', () => {
    const d = buildOrgDetail(baseInput())
    expect(d.integrations[0].providerLabel).toBe('Google Tasks')
    expect(d.integrations[0].statusLabel).toBe('接続中')
    expect(d.integrations[0].ownerTypeLabel).toBe('組織')
    expect(d.integrations[1].providerLabel).toBe('mystery')
    expect(d.integrations[1].statusLabel).toBe('weird')
    expect(d.integrations[1].ownerTypeLabel).toBe('個人')
  })

  it('招待は未承諾かつ期限内のものだけを出す', () => {
    const d = buildOrgDetail(baseInput())
    expect(d.pendingInvites.map((i) => i.email)).toEqual(['new@example.com'])
    expect(d.pendingInvites[0].roleLabel).toBe('メンバー')
    expect(d.pendingInvites[0].spaceName).toBe('案件A')
  })

  it('最近の通知は日本語の種類名・チャンネル名付き', () => {
    const d = buildOrgDetail(baseInput())
    expect(d.recentNotifications[0].typeLabel).toBe('社内承認依頼')
    expect(d.recentNotifications[0].channelLabel).toBe('アプリ内')
    expect(d.recentNotifications[0].isUnread).toBe(true)
    expect(d.recentNotifications[1].typeLabel).toBe('通知')
    expect(d.recentNotifications[1].channelLabel).toBe('LINE')
    expect(d.recentNotifications[1].isUnread).toBe(false)
  })
})
