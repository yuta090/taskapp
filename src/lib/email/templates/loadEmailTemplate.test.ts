import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * メール文面の読み込み。
 * 運営が管理画面で保存した文面（email_templates）があればそれを、なければ台帳の既定を使う。
 * DB が落ちていてもメール自体は止めない（必ず既定へフォールバック）。
 */
const selectMock = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: () => ({ select: () => ({ in: selectMock }) }) }),
}))

const { loadEmailTemplate, loadEmailTemplateRows, resetEmailTemplateCache } = await import('./loadEmailTemplate')
const { INVITE_TEMPLATE_DEFAULTS } = await import('./invite')
const { WELCOME_TEMPLATE_DEFAULTS } = await import('./welcome')
const { EMAIL_TEMPLATE_KEYS } = await import('./registry')

beforeEach(() => {
  vi.clearAllMocks()
  resetEmailTemplateCache()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('短い記憶（30秒）と同時呼び出しの束ね', () => {
  it('同時に何本呼んでも DB への問い合わせは1本、30秒以内の再呼び出しも読み直さない', async () => {
    selectMock.mockResolvedValue({ data: [], error: null })
    await Promise.all([loadEmailTemplate('invite_client'), loadEmailTemplate('welcome'), loadEmailTemplateRows()])
    expect(selectMock).toHaveBeenCalledTimes(1)
    await loadEmailTemplate('invite_client')
    expect(selectMock).toHaveBeenCalledTimes(1)
  })
  it('fresh:true は記憶を使わず読み直し、保存後の resetEmailTemplateCache で次の送信は新しい文面', async () => {
    selectMock.mockResolvedValue({ data: [], error: null })
    await loadEmailTemplate('invite_client')
    await loadEmailTemplateRows({ fresh: true })
    expect(selectMock).toHaveBeenCalledTimes(2)
    resetEmailTemplateCache()
    selectMock.mockResolvedValue({ data: [{ key: 'invite_client', subject: '新件名', heading: 'H', body: 'B', cta_label: 'C', note: '' }], error: null })
    expect((await loadEmailTemplate('invite_client')).subject).toBe('新件名')
  })
})

describe('loadEmailTemplate', () => {
  it('行が無ければコード既定を返す', async () => {
    selectMock.mockResolvedValue({ data: [], error: null })
    expect(await loadEmailTemplate('invite_client')).toEqual(INVITE_TEMPLATE_DEFAULTS.invite_client)
    expect(await loadEmailTemplate('welcome')).toEqual(WELCOME_TEMPLATE_DEFAULTS)
  })

  it('保存済みの行があればそれを使う（欠けている項目だけ既定で補う）', async () => {
    selectMock.mockResolvedValue({
      data: [{ key: 'invite_member', subject: '独自件名', heading: '独自見出し', body: '独自本文', cta_label: '入る', note: null, updated_at: '2026-09-07T00:00:00Z' }],
      error: null,
    })
    const f = await loadEmailTemplate('invite_member')
    expect(f.subject).toBe('独自件名')
    expect(f.cta_label).toBe('入る')
    expect(f.note).toBe(INVITE_TEMPLATE_DEFAULTS.invite_member.note)
    expect(await loadEmailTemplate('invite_client')).toEqual(INVITE_TEMPLATE_DEFAULTS.invite_client)
  })

  it('DBエラーでも既定へフォールバックして例外にしない', async () => {
    selectMock.mockResolvedValue({ data: null, error: { message: 'boom' } })
    await expect(loadEmailTemplate('invite_client')).resolves.toEqual(INVITE_TEMPLATE_DEFAULTS.invite_client)
    selectMock.mockRejectedValue(new Error('down'))
    await expect(loadEmailTemplate('invite_client')).resolves.toEqual(INVITE_TEMPLATE_DEFAULTS.invite_client)
  })

  it('台帳に無いキーはプログラムミスとして例外', async () => {
    selectMock.mockResolvedValue({ data: [], error: null })
    await expect(loadEmailTemplate('nope')).rejects.toThrow('unknown template key')
  })
})

describe('loadEmailTemplateRows', () => {
  it('台帳の全キーを「カスタム済みか」「更新日時」付きで返す（DBにある台帳外キーは無視）', async () => {
    selectMock.mockResolvedValue({
      data: [
        { key: 'invite_client', subject: 'S', heading: 'H', body: 'B', cta_label: 'C', note: 'N', updated_at: '2026-09-07T00:00:00Z' },
        { key: 'ghost', subject: 'x', heading: 'x', body: 'x', cta_label: 'x', note: '', updated_at: null },
      ],
      error: null,
    })
    const rows = await loadEmailTemplateRows()
    expect(Object.keys(rows).sort()).toEqual([...EMAIL_TEMPLATE_KEYS].sort())
    expect(rows.invite_client.isCustom).toBe(true)
    expect(rows.invite_client.updatedAt).toBe('2026-09-07T00:00:00Z')
    expect(rows.invite_client.fields.subject).toBe('S')
    expect(rows.welcome.isCustom).toBe(false)
    expect(rows.welcome.updatedAt).toBeNull()
    expect(rows.welcome.fields).toEqual(WELCOME_TEMPLATE_DEFAULTS)
    expect(rows.ghost).toBeUndefined()
  })
})
