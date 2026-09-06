import { describe, it, expect } from 'vitest'
import {
  findUnknownPlaceholders,
  renderSimpleEmail,
  renderTemplateString,
  sampleVars,
  validateTemplateFields,
  type TemplateFields,
} from './core'

const vars = { 組織名: '株式会社サンプル', 担当者名: '山田 太郎' }

describe('renderTemplateString', () => {
  it('日本語の差し込み語を値に置き換える', () => {
    expect(renderTemplateString('{{担当者名}} さんが {{組織名}} に', vars)).toBe('山田 太郎 さんが 株式会社サンプル に')
  })
  it('波かっこ内の余白は許容する', () => {
    expect(renderTemplateString('{{ 組織名 }}', vars)).toBe('株式会社サンプル')
  })
  it('知らない差し込み語はそのまま残す', () => {
    expect(renderTemplateString('{{謎}} と {{組織名}}', vars)).toBe('{{謎}} と 株式会社サンプル')
  })
  it('transform で差し込む値に加工をかけられる', () => {
    expect(renderTemplateString('{{組織名}}', { 組織名: '<b>' }, (v) => v.toUpperCase())).toBe('<B>')
  })
  it('prototype 由来の名前は差し込みとみなさない', () => {
    expect(renderTemplateString('{{constructor}}', {})).toBe('{{constructor}}')
  })
})

describe('findUnknownPlaceholders / sampleVars', () => {
  it('使えない差し込み語だけ列挙する', () => {
    expect(findUnknownPlaceholders('{{組織名}} {{相手}} {{相手}}', ['組織名'])).toEqual(['相手'])
  })
  it('sampleVars は名前→見本値', () => {
    expect(sampleVars([{ name: '組織名', description: '', sample: 'X' }])).toEqual({ 組織名: 'X' })
  })
})

describe('validateTemplateFields', () => {
  const good = { subject: '件名 {{組織名}}', heading: '見出し', body: '本文', cta_label: 'ボタン', note: '' }
  const allowed = ['組織名']

  it('正常な入力は trim して通す', () => {
    const r = validateTemplateFields({ ...good, subject: '  件名  ' }, allowed)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.fields.subject).toBe('件名')
  })
  it('必須項目が空なら弾く', () => {
    for (const k of ['subject', 'heading', 'body', 'cta_label'] as const) {
      expect(validateTemplateFields({ ...good, [k]: '   ' }, allowed).ok).toBe(false)
    }
  })
  it('note は空でよい・文字列以外は弾く', () => {
    expect(validateTemplateFields({ ...good, note: undefined }, allowed).ok).toBe(true)
    expect(validateTemplateFields({ ...good, note: 123 }, allowed).ok).toBe(false)
    expect(validateTemplateFields(null, allowed).ok).toBe(false)
  })
  it('件名など1行項目の改行は空白にそろえる（本文は改行を保つ）', () => {
    const r = validateTemplateFields({ ...good, subject: '件名\r\n二行目', body: '一行\r\n二行' }, allowed)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.fields.subject).toBe('件名 二行目')
      expect(r.fields.body).toBe('一行\n二行')
    }
  })
  it('長すぎる入力は弾く', () => {
    expect(validateTemplateFields({ ...good, subject: 'あ'.repeat(201) }, allowed).ok).toBe(false)
    expect(validateTemplateFields({ ...good, body: 'あ'.repeat(4001) }, allowed).ok).toBe(false)
  })
  it('そのテンプレートで使えない差し込み語が入っていたら弾く', () => {
    const r = validateTemplateFields({ ...good, body: '{{招待者名}} さんへ' }, allowed)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('招待者名')
  })
})

describe('renderSimpleEmail', () => {
  const fields: TemplateFields = {
    subject: '【{{サービス名}}】{{組織名}} から',
    heading: '見出し {{組織名}}',
    body: '一行目\n二行目\n\n二段落目 {{組織名}}',
    cta_label: '開く',
    note: '補足 <3',
  }
  const base = { appName: 'AgentPM', accent: '#123456', fields, vars: { 組織名: '<株式会社>', サービス名: 'AgentPM' }, ctaUrl: 'https://x.test/a?b=1&c=2' }

  it('件名・見出し・本文・ボタン・補足を差し込み済みで出す（HTMLはエスケープ、テキストは生）', () => {
    const out = renderSimpleEmail(base)
    expect(out.subject).toBe('【AgentPM】<株式会社> から')
    expect(out.html).toContain('見出し &lt;株式会社&gt;')
    expect(out.html).toContain('一行目<br>二行目')
    expect(out.html).toMatch(/<p[^>]*>\s*二段落目 &lt;株式会社&gt;\s*<\/p>/)
    expect(out.html).toContain('href="https://x.test/a?b=1&amp;c=2"')
    expect(out.html).toContain('>開く</a>')
    expect(out.html).toContain('補足 &lt;3')
    expect(out.html).toContain('#123456')
    expect(out.text).toContain('AgentPM - 見出し <株式会社>')
    expect(out.text).toContain('開く:\nhttps://x.test/a?b=1&c=2')
    expect(out.text).toContain('補足 <3')
  })

  it('文面に書かれた HTML も無害化される（XSS対策）', () => {
    const out = renderSimpleEmail({ ...base, fields: { ...fields, body: '<script>alert(1)</script>' } })
    expect(out.html).not.toContain('<script>')
    expect(out.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('引用メッセージ・前後の固定スロットが正しい位置に入る', () => {
    const out = renderSimpleEmail({
      ...base,
      message: 'ひとこと',
      beforeCta: { html: '<!--BEFORE-->', text: '\nBEFORE\n' },
      afterCta: { html: '<!--AFTER-->', text: '\nAFTER\n' },
    })
    const h = out.html
    expect(h.indexOf('ひとこと')).toBeLessThan(h.indexOf('<!--BEFORE-->'))
    expect(h.indexOf('<!--BEFORE-->')).toBeLessThan(h.indexOf('<!-- CTA Button -->'))
    expect(h.indexOf('補足 &lt;3')).toBeLessThan(h.indexOf('<!--AFTER-->'))
    expect(h.indexOf('<!--AFTER-->')).toBeLessThan(h.indexOf('<!-- Footer -->'))
    expect(out.text).toContain('ひとこと\n\nBEFORE\n\n開く:')
    expect(out.text).toContain('補足 <3\n\nAFTER\n\n---')
  })

  it('差し込み値に改行があっても件名は1行になる', () => {
    const out = renderSimpleEmail({ ...base, vars: { ...base.vars, 組織名: '一行目\r\n二行目' } })
    expect(out.subject).toBe('【AgentPM】一行目 二行目 から')
  })

  it('accent は属性値として無害化される', () => {
    const out = renderSimpleEmail({ ...base, accent: '#fff" onload="x' })
    expect(out.html).not.toContain('onload="x')
    expect(out.html).toContain('#fff&quot; onload=&quot;x')
  })

  it('補足が空なら補足の段落は出ない', () => {
    const out = renderSimpleEmail({ ...base, fields: { ...fields, note: '' } })
    expect(out.html).not.toContain('line-height: 1.5; text-align: center;')
  })
})
