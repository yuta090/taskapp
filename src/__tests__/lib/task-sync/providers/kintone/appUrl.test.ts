import { describe, it, expect } from 'vitest'
import { parseKintoneAppUrl } from '@/lib/task-sync/providers/kintone/appUrl'

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
