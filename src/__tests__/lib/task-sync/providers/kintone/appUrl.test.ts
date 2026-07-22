import { describe, it, expect } from 'vitest'
import { parseKintoneAppUrl, parseKintoneSubdomainInput } from '@/lib/task-sync/providers/kintone/appUrl'

describe('parseKintoneAppUrl', () => {
  it('アプリのトップURL(https://<sub>.cybozu.com/k/123/)を解析する', () => {
    const result = parseKintoneAppUrl('https://foo.cybozu.com/k/123/')
    expect(result).toEqual({ ok: true, data: { subdomain: 'foo', appId: '123' } })
  })

  it('レコード詳細URL(#以降のフラグメント)からも同じappIdを取り出す', () => {
    const result = parseKintoneAppUrl('https://foo.cybozu.com/k/123/show#record=5')
    expect(result).toEqual({ ok: true, data: { subdomain: 'foo', appId: '123' } })
  })

  it('末尾スラッシュが無いURLも受理する', () => {
    const result = parseKintoneAppUrl('https://foo.cybozu.com/k/123')
    expect(result).toEqual({ ok: true, data: { subdomain: 'foo', appId: '123' } })
  })

  it('ドメイン許可制プラン(.kintone.com)も受理する', () => {
    const result = parseKintoneAppUrl('https://foo.kintone.com/k/999/')
    expect(result).toEqual({ ok: true, data: { subdomain: 'foo', appId: '999' } })
  })

  it('数値だけの入力はアプリIDそのものとして受理する(subdomainはnull)', () => {
    const result = parseKintoneAppUrl('123')
    expect(result).toEqual({ ok: true, data: { subdomain: null, appId: '123' } })
  })

  it('前後の空白はtrimして受理する', () => {
    const result = parseKintoneAppUrl('  123  ')
    expect(result).toEqual({ ok: true, data: { subdomain: null, appId: '123' } })
  })

  it('数値だけの入力でも桁数が異常に多い(20桁超)場合は拒否する(上限が無いと巨大な文字列がそのまま保存され得る)', () => {
    const result = parseKintoneAppUrl('1'.repeat(21))
    expect(result.ok).toBe(false)
  })

  it('数値だけの入力はちょうど20桁までは受理する', () => {
    const result = parseKintoneAppUrl('1'.repeat(20))
    expect(result).toEqual({ ok: true, data: { subdomain: null, appId: '1'.repeat(20) } })
  })

  it('空文字は拒否する', () => {
    const result = parseKintoneAppUrl('')
    expect(result.ok).toBe(false)
  })

  it('別サービスのURLは拒否する(SSRF境界)', () => {
    const result = parseKintoneAppUrl('https://evil.example.com/k/123/')
    expect(result.ok).toBe(false)
  })

  it('cybozu.comを装った別ドメイン(ドット境界攻撃)は拒否する', () => {
    expect(parseKintoneAppUrl('https://evil-cybozu.com/k/123/').ok).toBe(false)
    expect(parseKintoneAppUrl('https://foo.cybozu.com.evil.com/k/123/').ok).toBe(false)
  })

  it('javascript:スキームは拒否する', () => {
    const result = parseKintoneAppUrl('javascript:alert(1)')
    expect(result.ok).toBe(false)
  })

  it('http(平文)は拒否する', () => {
    const result = parseKintoneAppUrl('http://foo.cybozu.com/k/123/')
    expect(result.ok).toBe(false)
  })

  it('/k/<数字>/ 形式でないパスは拒否する', () => {
    const result = parseKintoneAppUrl('https://foo.cybozu.com/some/other/path')
    expect(result.ok).toBe(false)
  })

  it('ゲストスペース配下のアプリURLは非対応として拒否する', () => {
    const result = parseKintoneAppUrl('https://foo.cybozu.com/k/guest/1/123/')
    expect(result.ok).toBe(false)
  })

  it('認証情報(userinfo)を含むURLは拒否する', () => {
    const result = parseKintoneAppUrl('https://user:pass@foo.cybozu.com/k/123/')
    expect(result.ok).toBe(false)
  })

  it('非標準ポートを含むURLは拒否する', () => {
    const result = parseKintoneAppUrl('https://foo.cybozu.com:8443/k/123/')
    expect(result.ok).toBe(false)
  })
})

/**
 * parseKintoneSubdomainInput — 接続フォームの「サブドメイン」欄専用の解析(純関数)。
 * parseKintoneAppUrl と違い `/k/<数字>/` パスを要求しない(サブドメインだけの入力/URL双方を許す)。
 */
describe('parseKintoneSubdomainInput', () => {
  it('裸のサブドメイン(英数字とハイフンのみ)を受理し、baseUrlを組み立てる', () => {
    const result = parseKintoneSubdomainInput('my-company')
    expect(result).toEqual({ ok: true, baseUrl: 'https://my-company.cybozu.com', subdomain: 'my-company' })
  })

  it('サブドメインのみのURL(パス無し)を受理する', () => {
    const result = parseKintoneSubdomainInput('https://foo.cybozu.com')
    expect(result).toEqual({ ok: true, baseUrl: 'https://foo.cybozu.com', subdomain: 'foo' })
  })

  it('アプリURL(/k/123/付き)を渡してもサブドメインだけ取り出せる', () => {
    const result = parseKintoneSubdomainInput('https://foo.cybozu.com/k/123/')
    expect(result).toEqual({ ok: true, baseUrl: 'https://foo.cybozu.com', subdomain: 'foo' })
  })

  it('ドメイン許可制プラン(.kintone.com)も受理する', () => {
    const result = parseKintoneSubdomainInput('https://foo.kintone.com/')
    expect(result).toEqual({ ok: true, baseUrl: 'https://foo.kintone.com', subdomain: 'foo' })
  })

  it('前後の空白はtrimする', () => {
    const result = parseKintoneSubdomainInput('  my-company  ')
    expect(result).toEqual({ ok: true, baseUrl: 'https://my-company.cybozu.com', subdomain: 'my-company' })
  })

  it('空文字は拒否する', () => {
    expect(parseKintoneSubdomainInput('').ok).toBe(false)
    expect(parseKintoneSubdomainInput('   ').ok).toBe(false)
  })

  it('別サービスのURLは拒否する(SSRF境界。assertAllowedHostへ委譲)', () => {
    expect(parseKintoneSubdomainInput('https://evil.example.com').ok).toBe(false)
  })

  it('cybozu.comを装った別ドメイン(ドット境界攻撃)は拒否する', () => {
    expect(parseKintoneSubdomainInput('https://evil-cybozu.com').ok).toBe(false)
    expect(parseKintoneSubdomainInput('https://foo.cybozu.com.evil.com').ok).toBe(false)
  })

  it('http(平文)は拒否する', () => {
    expect(parseKintoneSubdomainInput('http://foo.cybozu.com').ok).toBe(false)
  })

  it('認証情報(userinfo)を含むURLは拒否する', () => {
    expect(parseKintoneSubdomainInput('https://user:pass@foo.cybozu.com').ok).toBe(false)
  })

  it('ドット・スラッシュを含む裸文字列(URLでもサブドメイン単体でもない)は拒否する', () => {
    // 「サブドメインらしい裸文字列」の判定(英数字とハイフンのみ)に当てはまらず、
    // かつURLとしても解析できない入力(例: "foo/bar")は理由付きで拒否する。
    const result = parseKintoneSubdomainInput('foo/bar')
    expect(result.ok).toBe(false)
  })

  it('先頭がハイフンの裸サブドメインは拒否する(DNSラベルとして不正)', () => {
    expect(parseKintoneSubdomainInput('-my-company').ok).toBe(false)
  })

  it('末尾がハイフンの裸サブドメインは拒否する(DNSラベルとして不正)', () => {
    expect(parseKintoneSubdomainInput('my-company-').ok).toBe(false)
  })

  it('異常に長い裸サブドメイン(DNSラベル上限64文字超)は拒否する', () => {
    expect(parseKintoneSubdomainInput('a'.repeat(64)).ok).toBe(false)
  })

  it('DNSラベル上限ちょうど(63文字)の裸サブドメインは受理する', () => {
    const sub = 'a'.repeat(63)
    expect(parseKintoneSubdomainInput(sub)).toEqual({ ok: true, baseUrl: `https://${sub}.cybozu.com`, subdomain: sub })
  })
})
