import { describe, it, expect } from 'vitest'
import { renderEmailPreview } from './serverPreview'
import { EMAIL_TEMPLATE_DEFS } from './registry'

describe('renderEmailPreview', () => {
  it('台帳の全キーが既定文面でプレビューでき、差し込み語が残らない', async () => {
    for (const d of EMAIL_TEMPLATE_DEFS) {
      const out = await renderEmailPreview(d.key, d.defaults, 'AgentPM')
      expect(out, d.key).not.toBeNull()
      expect(out!.html.startsWith('<!DOCTYPE html')).toBe(true)
      expect(out!.html).not.toContain('{{')
      expect(out!.text).not.toContain('{{')
      expect(out!.subject.length).toBeGreaterThan(0)
    }
  }, 30000)

  it('承認依頼: 文面に書いた HTML はエスケープされ、タスクカード・金額は固定で出る', async () => {
    const out = await renderEmailPreview('approval_estimate', { subject: 'S', heading: '<b>見出し</b>', body: '<script>alert(1)</script>\n二行目', cta_label: '押す', note: '補足' }, 'AgentPM')
    expect(out!.html).not.toContain('<script>')
    expect(out!.html).toContain('&lt;script&gt;')
    expect(out!.html).toContain('&lt;b&gt;見出し&lt;/b&gt;')
    expect(out!.html).toContain('<br')
    expect(out!.html).toContain('￥160,000')
    expect(out!.html).toContain('フロントエンド実装 - ログイン画面')
    expect(out!.html).toContain('押す')
    expect(out!.html).toContain('補足')
  })

  it('滞留リマインド: 超過ありキーは期限超過の節を出し、ボタンの文字は文面どおり', async () => {
    const out = await renderEmailPreview('reminder_client_overdue', { subject: 'S', heading: 'H', body: 'B', cta_label: '見る', note: '' }, 'AgentPM')
    expect(out!.html).toContain('期限を過ぎています')
    expect(out!.html).toContain('見る')
    expect(out!.html).toContain('クライアント太郎')
    expect(out!.text).toContain('クライアント太郎 様')
  })

  it('台帳外キーは null', async () => {
    expect(await renderEmailPreview('nope', { subject: '', heading: '', body: '', cta_label: '', note: '' }, 'X')).toBeNull()
  })
})
