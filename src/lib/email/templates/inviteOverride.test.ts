import { describe, it, expect } from 'vitest'
import { INVITE_TEMPLATE_DEFAULTS, INVITE_PLACEHOLDERS } from './invite'
import { isTemplateEdited, mergeTemplateOverride, validateTemplateOverride } from './inviteOverride'

const base = INVITE_TEMPLATE_DEFAULTS.invite_member
const allowed = INVITE_PLACEHOLDERS.map((p) => p.name)

describe('mergeTemplateOverride', () => {
  it('渡された項目だけを差し替え、残りは元の文面のまま', () => {
    const merged = mergeTemplateOverride(base, { subject: '新しい件名' })
    expect(merged.subject).toBe('新しい件名')
    expect(merged.body).toBe(base.body)
    expect(merged.cta_label).toBe(base.cta_label)
  })

  it('空文字も「消した」として扱う（補足を空にできる）', () => {
    const merged = mergeTemplateOverride(base, { note: '' })
    expect(merged.note).toBe('')
  })

  it('文字列でない値・知らないキーは無視する', () => {
    const merged = mergeTemplateOverride(base, { subject: 123, heading: null, nope: 'x' })
    expect(merged).toEqual(base)
  })

  it('null / undefined のときは元の文面をそのまま返す', () => {
    expect(mergeTemplateOverride(base, null)).toEqual(base)
    expect(mergeTemplateOverride(base, undefined)).toEqual(base)
  })

  it('元の文面を書き換えない', () => {
    const snapshot = { ...base }
    mergeTemplateOverride(base, { subject: 'x' })
    expect(base).toEqual(snapshot)
  })
})

describe('validateTemplateOverride', () => {
  it('差し替えた結果を検証して返す', () => {
    const result = validateTemplateOverride(base, { subject: ' 余白は落ちる ' }, allowed)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.fields.subject).toBe('余白は落ちる')
  })

  it('使えない差し込み語があれば断る', () => {
    const result = validateTemplateOverride(base, { body: '{{存在しない語}}' }, allowed)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('存在しない語')
  })

  it('必須項目を空にはできない', () => {
    const result = validateTemplateOverride(base, { subject: '   ' }, allowed)
    expect(result.ok).toBe(false)
  })

  it('長すぎる本文は断る', () => {
    const result = validateTemplateOverride(base, { body: 'あ'.repeat(4001) }, allowed)
    expect(result.ok).toBe(false)
  })
})

describe('isTemplateEdited', () => {
  it('同じ内容なら false', () => {
    expect(isTemplateEdited(base, { ...base })).toBe(false)
  })

  it('前後の余白だけの違いは編集とみなさない', () => {
    expect(isTemplateEdited(base, { ...base, subject: `  ${base.subject}  ` })).toBe(false)
  })

  it('中身が違えば true', () => {
    expect(isTemplateEdited(base, { ...base, note: 'ひとこと足した' })).toBe(true)
  })
})
