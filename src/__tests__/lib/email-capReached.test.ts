import { describe, it, expect, vi, beforeEach } from 'vitest'

/** 上限到達メール2通の送信側: 管理画面の文面（無ければ既定）で Resend に渡す */
const mockSend = vi.fn().mockResolvedValue({ data: { id: 'msg' }, error: null })
vi.mock('resend', () => ({ Resend: class { emails = { send: mockSend } } }))

let templateRows: Array<Record<string, unknown>> = []
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: () => ({ select: () => ({ in: () => Promise.resolve({ data: templateRows, error: null }) }) }) }),
}))

process.env.RESEND_API_KEY = 'test'
process.env.FROM_EMAIL = 'noreply@example.com'
process.env.NEXT_PUBLIC_APP_NAME = 'AgentPM'
process.env.NEXT_PUBLIC_APP_URL = 'https://agentpm.app'

const { sendFreeCapUpgradeEmail } = await import('@/lib/email/freeCapUpgrade')
const { sendPoolAiExhaustedEmail } = await import('@/lib/email/poolAiExhausted')

beforeEach(() => {
  vi.clearAllMocks()
  templateRows = []
})

describe('sendFreeCapUpgradeEmail', () => {
  it('既定文面で送る（上限50・課金ページへの導線・組織名エスケープ）', async () => {
    await sendFreeCapUpgradeEmail({ to: 'owner@example.com', orgName: '<Org>' })
    const a = mockSend.mock.calls[0][0]
    expect(a.to).toBe('owner@example.com')
    expect(a.subject).toContain('今月の無料通知枠に達しました')
    expect(a.html).toContain('（50通）')
    expect(a.html).toContain('&lt;Org&gt;')
    expect(a.html).toContain('https://agentpm.app/settings/billing')
    expect(a.text).toContain('プランを確認する:\nhttps://agentpm.app/settings/billing')
  })

  it('保存された文面があればそれで送る', async () => {
    templateRows = [{ key: 'free_cap_upgrade', subject: '独自 {{組織名}}', heading: 'H', body: 'B', cta_label: 'C', note: '' }]
    await sendFreeCapUpgradeEmail({ to: 'o@example.com', orgName: 'Org', limit: 100 })
    expect(mockSend.mock.calls[0][0].subject).toBe('独自 Org')
  })
})

describe('sendPoolAiExhaustedEmail', () => {
  it('既定文面で送る（AIキー設定ページへの導線）', async () => {
    await sendPoolAiExhaustedEmail({ to: 'owner@example.com', orgName: 'Org' })
    const a = mockSend.mock.calls[0][0]
    expect(a.subject).toContain('プールAIの今月の上限に達しました')
    expect(a.html).toContain('https://agentpm.app/settings/org-integrations')
    expect(a.html).toContain('>AIキーを登録する</a>')
  })
})
