import { describe, it, expect } from 'vitest'
import {
  isValidSlug,
  isValidButtonUrl,
  validatePostInput,
  validateCtaInput,
} from '@/lib/blog/validation'

describe('isValidSlug', () => {
  it('小文字英数とハイフンを許可する', () => {
    expect(isValidSlug('tax-document-collection')).toBe(true)
    expect(isValidSlug('abc123')).toBe(true)
  })
  it('大文字・日本語・スペース・記号を拒否する', () => {
    expect(isValidSlug('Tax-Doc')).toBe(false)
    expect(isValidSlug('資料回収')).toBe(false)
    expect(isValidSlug('a b')).toBe(false)
    expect(isValidSlug('a_b')).toBe(false)
    expect(isValidSlug('')).toBe(false)
  })
})

describe('isValidButtonUrl', () => {
  it('相対パスと https を許可する', () => {
    expect(isValidButtonUrl('/contact')).toBe(true)
    expect(isValidButtonUrl('https://skara.co.jp/shindan')).toBe(true)
  })
  it('javascript: や http: や他スキームを拒否する', () => {
    expect(isValidButtonUrl('javascript:alert(1)')).toBe(false)
    expect(isValidButtonUrl('http://insecure.example')).toBe(false)
    expect(isValidButtonUrl('mailto:x@y.z')).toBe(false)
    expect(isValidButtonUrl('contact')).toBe(false)
  })
})

describe('validatePostInput', () => {
  it('正常な入力を通す', () => {
    const r = validatePostInput({ slug: 'hello', title: 'こんにちは', status: 'draft' })
    expect(r.ok).toBe(true)
  })
  it('不正な slug を弾く', () => {
    const r = validatePostInput({ slug: 'Bad Slug', title: 'x' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/slug/i)
  })
  it('空タイトルを弾く', () => {
    const r = validatePostInput({ slug: 'ok', title: '' })
    expect(r.ok).toBe(false)
  })
  it('長すぎるタイトル(121文字)を弾く', () => {
    const r = validatePostInput({ slug: 'ok', title: 'あ'.repeat(121) })
    expect(r.ok).toBe(false)
  })
  it('不正な status を弾く', () => {
    const r = validatePostInput({ slug: 'ok', title: 'x', status: 'live' })
    expect(r.ok).toBe(false)
  })
})

describe('validateCtaInput', () => {
  it('正常な入力を通す', () => {
    const r = validateCtaInput({
      key: 'contact', name: '相談', heading: '見出し',
      button_label: '相談する', button_url: '/contact',
    })
    expect(r.ok).toBe(true)
  })
  it('不正な button_url を弾く', () => {
    const r = validateCtaInput({
      key: 'x', name: 'n', heading: 'h',
      button_label: 'l', button_url: 'javascript:alert(1)',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/url/i)
  })
  it('不正な variant を弾く', () => {
    const r = validateCtaInput({
      key: 'x', name: 'n', heading: 'h',
      button_label: 'l', button_url: '/x', variant: 'popup',
    })
    expect(r.ok).toBe(false)
  })
})
