import { describe, it, expect } from 'vitest'
import { createAuthContext } from './authorize.js'

/**
 * change_log トリガー（誰が・どの経路で書いたか）向けの channel。
 * createAuthContext は呼び出し元（どの受け口で認証したか）から渡された channel を
 * そのまま AuthContext に載せる（API キーの行データには channel が無いため、必ず
 * 引数で渡す）。
 */
describe('createAuthContext — channel', () => {
  const keyData = {
    key_id: 'kid-1',
    user_id: 'user-1',
    org_id: 'org-1',
    scope: 'org',
    allowed_space_ids: null,
    allowed_actions: ['read', 'write'],
  }

  it('渡された channel をそのまま載せる', () => {
    const ctx = createAuthContext(keyData, 'cli')
    expect(ctx.channel).toBe('cli')
  })

  it('mcp / stdio でも同様', () => {
    expect(createAuthContext(keyData, 'mcp').channel).toBe('mcp')
    expect(createAuthContext(keyData, 'stdio').channel).toBe('stdio')
  })
})
