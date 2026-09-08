import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 招待メールの文面の決まり方:
 *   事務所の保存(org_email_templates) → 運営の保存(email_templates) → コード既定
 * 事務所の行は招待1通につき1回だけ読む（記憶しない）ので、保存した直後から反映される。
 */
const orgSingleMock = vi.fn()
const platformSelectMock = vi.fn()

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'org_email_templates') {
        return {
          select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: orgSingleMock }) }) }),
        }
      }
      return { select: () => ({ in: platformSelectMock }) }
    },
  }),
}))

const { resolveEmailTemplate, loadOrgEmailTemplate } = await import('./orgEmailTemplate')
const { resetEmailTemplateCache } = await import('./loadEmailTemplate')
const { INVITE_TEMPLATE_DEFAULTS } = await import('./invite')

const ORG_ID = '11111111-1111-4111-8111-111111111111'
const orgRow = {
  subject: '事務所の件名',
  heading: '事務所の見出し',
  body: '事務所の本文',
  cta_label: '事務所のボタン',
  note: '',
}

beforeEach(() => {
  vi.clearAllMocks()
  resetEmailTemplateCache()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  platformSelectMock.mockResolvedValue({ data: [], error: null })
  orgSingleMock.mockResolvedValue({ data: null, error: null })
})

describe('resolveEmailTemplate', () => {
  it('事務所の保存があればそれを使う', async () => {
    orgSingleMock.mockResolvedValue({ data: orgRow, error: null })
    const result = await resolveEmailTemplate(ORG_ID, 'invite_member')
    expect(result.source).toBe('org')
    expect(result.fields.subject).toBe('事務所の件名')
  })

  it('事務所の保存が無ければ運営の保存を使う', async () => {
    platformSelectMock.mockResolvedValue({
      data: [{ key: 'invite_member', subject: '運営の件名', heading: 'H', body: 'B', cta_label: 'C', note: '' }],
      error: null,
    })
    const result = await resolveEmailTemplate(ORG_ID, 'invite_member')
    expect(result.source).toBe('platform')
    expect(result.fields.subject).toBe('運営の件名')
  })

  it('どちらも無ければコード既定を使う', async () => {
    const result = await resolveEmailTemplate(ORG_ID, 'invite_member')
    expect(result.source).toBe('code')
    expect(result.fields).toEqual(INVITE_TEMPLATE_DEFAULTS.invite_member)
  })

  it('事務所の読み取りに失敗しても送信は止めない（運営/既定に落ちる）', async () => {
    orgSingleMock.mockResolvedValue({ data: null, error: { message: 'boom' } })
    const result = await resolveEmailTemplate(ORG_ID, 'invite_member')
    expect(result.source).toBe('code')
    expect(result.fields).toEqual(INVITE_TEMPLATE_DEFAULTS.invite_member)
  })

  it('事務所が分からないときは事務所の行を読みに行かない', async () => {
    await resolveEmailTemplate(null, 'invite_member')
    expect(orgSingleMock).not.toHaveBeenCalled()
  })

  it('事務所が触れないキー（承認依頼など）は事務所の行を読みに行かない', async () => {
    await resolveEmailTemplate(ORG_ID, 'welcome')
    expect(orgSingleMock).not.toHaveBeenCalled()
  })

  it('台帳に無いキーは例外（プログラムの間違い）', async () => {
    await expect(resolveEmailTemplate(ORG_ID, 'nope')).rejects.toThrow('unknown template key')
  })

  it('毎回読み直す（保存した直後から反映される）', async () => {
    orgSingleMock.mockResolvedValue({ data: orgRow, error: null })
    await resolveEmailTemplate(ORG_ID, 'invite_member')
    orgSingleMock.mockResolvedValue({ data: { ...orgRow, subject: '直した件名' }, error: null })
    const result = await resolveEmailTemplate(ORG_ID, 'invite_member')
    expect(result.fields.subject).toBe('直した件名')
    expect(orgSingleMock).toHaveBeenCalledTimes(2)
  })
})

describe('loadOrgEmailTemplate', () => {
  it('欠けている項目は運営/既定の文面で補う', async () => {
    orgSingleMock.mockResolvedValue({ data: { subject: '件名だけ保存' }, error: null })
    const fields = await loadOrgEmailTemplate(ORG_ID, 'invite_member')
    expect(fields?.subject).toBe('件名だけ保存')
    expect(fields?.body).toBe(INVITE_TEMPLATE_DEFAULTS.invite_member.body)
  })
})
