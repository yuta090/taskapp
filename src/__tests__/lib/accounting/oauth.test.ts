import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * 戻り先URL（コールバックURL）の解決。
 *
 * ここを取り違えると、各社の画面には「リダイレクトURIが一致しません」としか出ず、
 * 原因が分からないまま時間を溶かす。壊れたURLを組んで飛ばすくらいなら落とす。
 */

const ORIGINAL_ENV = { ...process.env }

async function loadModule() {
  vi.resetModules()
  return import('@/lib/accounting/oauth')
}

describe('getAccountingRedirectUri', () => {
  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_APP_URL
    delete process.env.FREEE_REDIRECT_URI
    delete process.env.MONEY_FORWARD_REDIRECT_URI
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  it('provider ごとの明示指定を最優先で使う', async () => {
    process.env.FREEE_REDIRECT_URI = 'https://agentpm.app/api/integrations/callback/freee'
    process.env.NEXT_PUBLIC_APP_URL = 'https://example.invalid'

    const { getAccountingRedirectUri } = await loadModule()
    expect(getAccountingRedirectUri('freee')).toBe('https://agentpm.app/api/integrations/callback/freee')
  })

  it('明示指定が無ければ APP_URL から組み立てる', async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://agentpm.app'

    const { getAccountingRedirectUri } = await loadModule()
    expect(getAccountingRedirectUri('money_forward')).toBe(
      'https://agentpm.app/api/integrations/callback/money_forward',
    )
  })

  it('APP_URL の末尾スラッシュでURLを二重にしない', async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://agentpm.app/'

    const { getAccountingRedirectUri } = await loadModule()
    expect(getAccountingRedirectUri('misoca')).toBe('https://agentpm.app/api/integrations/callback/misoca')
  })

  it('どちらも無ければ壊れたURLを作らず落とす', async () => {
    const { getAccountingRedirectUri } = await loadModule()
    expect(() => getAccountingRedirectUri('freee')).toThrow(/FREEE_REDIRECT_URI/)
  })
})

describe('isAccountingOAuthConfigured', () => {
  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_APP_URL
    delete process.env.FREEE_REDIRECT_URI
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  it('鍵が揃っていても戻り先が無ければ未設定として扱う（押す前に分かるようにする）', async () => {
    process.env.FREEE_CLIENT_ID = 'id'
    process.env.FREEE_CLIENT_SECRET = 'secret'

    const { isAccountingOAuthConfigured } = await loadModule()
    expect(isAccountingOAuthConfigured('freee')).toBe(false)
  })

  it('鍵と戻り先が揃えば設定済み', async () => {
    process.env.FREEE_CLIENT_ID = 'id'
    process.env.FREEE_CLIENT_SECRET = 'secret'
    process.env.FREEE_REDIRECT_URI = 'https://agentpm.app/api/integrations/callback/freee'

    const { isAccountingOAuthConfigured } = await loadModule()
    expect(isAccountingOAuthConfigured('freee')).toBe(true)
  })

  it('鍵が無ければ未設定', async () => {
    delete process.env.FREEE_CLIENT_ID
    delete process.env.FREEE_CLIENT_SECRET
    process.env.FREEE_REDIRECT_URI = 'https://agentpm.app/api/integrations/callback/freee'

    const { isAccountingOAuthConfigured } = await loadModule()
    expect(isAccountingOAuthConfigured('freee')).toBe(false)
  })
})
