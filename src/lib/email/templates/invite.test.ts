import { describe, it, expect } from 'vitest'
import {
  INVITE_TEMPLATE_DEFAULTS,
  INVITE_PLACEHOLDERS,
  renderTemplateString,
  renderInviteEmail,
  validateInviteTemplateFields,
  type InviteTemplateVars,
} from './invite'

const vars: InviteTemplateVars = {
  inviterName: '山田 太郎',
  orgName: '株式会社サンプル',
  spaceName: 'ホームページ制作',
  expiresDate: '2026年9月14日',
  appName: 'AgentPM',
}

describe('renderTemplateString', () => {
  it('日本語の差し込み語を値に置き換える', () => {
    expect(renderTemplateString('{{招待者名}} さんが {{組織名}} に招待', vars)).toBe(
      '山田 太郎 さんが 株式会社サンプル に招待',
    )
  })

  it('波かっこ内の余白は許容する', () => {
    expect(renderTemplateString('{{ プロジェクト名 }}', vars)).toBe('ホームページ制作')
  })

  it('知らない差し込み語はそのまま残す', () => {
    expect(renderTemplateString('{{謎}} と {{有効期限}}', vars)).toBe('{{謎}} と 2026年9月14日')
  })

  it('INVITE_PLACEHOLDERS の全トークンが置換対象になっている', () => {
    for (const p of INVITE_PLACEHOLDERS) {
      expect(renderTemplateString(p.token, vars)).toBe(vars[p.varKey])
    }
  })
})

describe('renderInviteEmail', () => {
  const inviteUrl = 'https://agentpm.app/portal/tok-1?x=1&y=2'

  it('既定の相手先向け文面: 件名・見出し・本文・ボタンが差し込み済みで出る', () => {
    const out = renderInviteEmail({
      variant: 'client',
      fields: INVITE_TEMPLATE_DEFAULTS.invite_client,
      vars,
      inviteUrl,
    })
    expect(out.subject).toBe('【AgentPM】株式会社サンプル からプロジェクトへの招待')
    expect(out.html).toContain('プロジェクトへの招待')
    expect(out.html).toContain('山田 太郎 さんが、株式会社サンプル の「ホームページ制作」プロジェクトにあなたを招待しました。')
    expect(out.html).toContain('>ポータルにアクセス<')
    expect(out.html).toContain('href="https://agentpm.app/portal/tok-1?x=1&amp;y=2"')
    expect(out.html).toContain('<strong>2026年9月14日</strong>')
    expect(out.html).toContain('アカウント登録は不要です')
    // 相手先向けは amber
    expect(out.html).toContain('#f59e0b')
    expect(out.text).toContain('AgentPM - プロジェクトへの招待')
    expect(out.text).toContain('ポータルにアクセス:\nhttps://agentpm.app/portal/tok-1?x=1&y=2')
    expect(out.text).toContain('この招待リンクは 2026年9月14日 まで有効です。')
  })

  it('既定のメンバー向け文面: indigo・承諾ボタン・補足なし', () => {
    const out = renderInviteEmail({
      variant: 'member',
      fields: INVITE_TEMPLATE_DEFAULTS.invite_member,
      vars,
      inviteUrl: 'https://agentpm.app/invite/tok-2',
    })
    expect(out.subject).toBe('【AgentPM】株式会社サンプル のチームに招待されました')
    expect(out.html).toContain('#4f46e5')
    expect(out.html).toContain('>招待を承諾する<')
    expect(out.html).toContain('メンバーとして招待しました')
    expect(out.html).not.toContain('アカウント登録は不要です')
    expect(out.text).toContain('招待を承諾する:\nhttps://agentpm.app/invite/tok-2')
  })

  it('本文の空行は段落、単独改行は <br> になる', () => {
    const out = renderInviteEmail({
      variant: 'member',
      fields: { ...INVITE_TEMPLATE_DEFAULTS.invite_member, body: '一行目\n二行目\n\n二段落目' },
      vars,
      inviteUrl,
    })
    expect(out.html).toContain('一行目<br>二行目')
    expect(out.html).toMatch(/<p[^>]*>\s*二段落目\s*<\/p>/)
    expect(out.text).toContain('一行目\n二行目\n\n二段落目')
  })

  it('差し込み値と文面内のHTMLはエスケープされる（XSS対策）', () => {
    const out = renderInviteEmail({
      variant: 'client',
      fields: { ...INVITE_TEMPLATE_DEFAULTS.invite_client, body: '<b>太字</b> {{招待者名}}' },
      vars: { ...vars, inviterName: '<script>alert(1)</script>' },
      inviteUrl,
    })
    expect(out.html).not.toContain('<script>')
    expect(out.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(out.html).toContain('&lt;b&gt;太字&lt;/b&gt;')
    // テキスト版は生のまま
    expect(out.text).toContain('<script>alert(1)</script>')
  })

  it('招待者からの一言メッセージは引用として入る', () => {
    const out = renderInviteEmail({
      variant: 'client',
      fields: INVITE_TEMPLATE_DEFAULTS.invite_client,
      vars,
      inviteUrl,
      message: 'よろしく\nお願いします <3',
    })
    expect(out.html).toContain('よろしく<br>お願いします &lt;3')
    expect(out.text).toContain('\nよろしく\nお願いします <3\n')
  })

  it('補足(note)が空ならボタン下の補足は出ない', () => {
    const out = renderInviteEmail({
      variant: 'client',
      fields: { ...INVITE_TEMPLATE_DEFAULTS.invite_client, note: '' },
      vars,
      inviteUrl,
    })
    expect(out.html).not.toContain('アカウント登録は不要です')
  })
})

describe('validateInviteTemplateFields', () => {
  const good = {
    subject: '件名 {{組織名}}',
    heading: '見出し',
    body: '本文',
    cta_label: 'ボタン',
    note: '',
  }

  it('正常な入力は trim して通す', () => {
    const r = validateInviteTemplateFields({ ...good, subject: '  件名  ' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.fields.subject).toBe('件名')
  })

  it('必須項目が空なら弾く', () => {
    for (const k of ['subject', 'heading', 'body', 'cta_label'] as const) {
      const r = validateInviteTemplateFields({ ...good, [k]: '   ' })
      expect(r.ok).toBe(false)
    }
  })

  it('note は空でよい・文字列以外は弾く', () => {
    expect(validateInviteTemplateFields({ ...good, note: undefined }).ok).toBe(true)
    expect(validateInviteTemplateFields({ ...good, note: 123 }).ok).toBe(false)
    expect(validateInviteTemplateFields(null).ok).toBe(false)
  })

  it('件名など1行項目の改行は空白にそろえる（本文は改行を保つ）', () => {
    const r = validateInviteTemplateFields({ ...good, subject: '件名\r\n二行目', body: '一行\r\n二行' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.fields.subject).toBe('件名 二行目')
      expect(r.fields.body).toBe('一行\n二行')
    }
  })

  it('長すぎる入力は弾く', () => {
    expect(validateInviteTemplateFields({ ...good, subject: 'あ'.repeat(201) }).ok).toBe(false)
    expect(validateInviteTemplateFields({ ...good, body: 'あ'.repeat(4001) }).ok).toBe(false)
  })

  it('知らない差し込み語が入っていたら弾く（送信時に置換されず残るため）', () => {
    const r = validateInviteTemplateFields({ ...good, body: '{{相手の名前}} さんへ' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('相手の名前')
  })
})
