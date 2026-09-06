import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 招待メール文面の読み込み。
 * 運営が管理画面で保存した文面（email_templates）があればそれを、なければコード既定を使う。
 * DB が落ちていても招待メール自体は止めない（必ず既定へフォールバック）。
 */
const selectMock = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: () => ({ select: selectMock }) }),
}))

const { loadInviteTemplate, loadInviteTemplateRows } = await import('./loadInviteTemplate')
const { INVITE_TEMPLATE_DEFAULTS } = await import('./invite')

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('loadInviteTemplate', () => {
  it('行が無ければコード既定を返す', async () => {
    selectMock.mockResolvedValue({ data: [], error: null })
    const f = await loadInviteTemplate('invite_client')
    expect(f).toEqual(INVITE_TEMPLATE_DEFAULTS.invite_client)
  })

  it('保存済みの行があればそれを使う（欠けている項目だけ既定で補う）', async () => {
    selectMock.mockResolvedValue({
      data: [{ key: 'invite_member', subject: '独自件名', heading: '独自見出し', body: '独自本文', cta_label: '入る', note: null, updated_at: '2026-09-07T00:00:00Z' }],
      error: null,
    })
    const f = await loadInviteTemplate('invite_member')
    expect(f.subject).toBe('独自件名')
    expect(f.cta_label).toBe('入る')
    expect(f.note).toBe(INVITE_TEMPLATE_DEFAULTS.invite_member.note)
    // 別キーは既定のまま
    expect(await loadInviteTemplate('invite_client')).toEqual(INVITE_TEMPLATE_DEFAULTS.invite_client)
  })

  it('DBエラーでも既定へフォールバックして例外にしない', async () => {
    selectMock.mockResolvedValue({ data: null, error: { message: 'boom' } })
    await expect(loadInviteTemplate('invite_client')).resolves.toEqual(INVITE_TEMPLATE_DEFAULTS.invite_client)
    selectMock.mockRejectedValue(new Error('down'))
    await expect(loadInviteTemplate('invite_client')).resolves.toEqual(INVITE_TEMPLATE_DEFAULTS.invite_client)
  })
})

describe('loadInviteTemplateRows', () => {
  it('管理画面用に「カスタム済みか」「更新日時」を付けて両方返す', async () => {
    selectMock.mockResolvedValue({
      data: [{ key: 'invite_client', subject: 'S', heading: 'H', body: 'B', cta_label: 'C', note: 'N', updated_at: '2026-09-07T00:00:00Z' }],
      error: null,
    })
    const rows = await loadInviteTemplateRows()
    expect(rows.invite_client.isCustom).toBe(true)
    expect(rows.invite_client.updatedAt).toBe('2026-09-07T00:00:00Z')
    expect(rows.invite_client.fields.subject).toBe('S')
    expect(rows.invite_member.isCustom).toBe(false)
    expect(rows.invite_member.updatedAt).toBeNull()
    expect(rows.invite_member.fields).toEqual(INVITE_TEMPLATE_DEFAULTS.invite_member)
  })
})
