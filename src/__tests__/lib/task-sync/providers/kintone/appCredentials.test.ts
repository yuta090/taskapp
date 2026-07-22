import { describe, it, expect } from 'vitest'
import { validateKintoneAppCredentials } from '@/lib/task-sync/providers/kintone/appCredentials'

/**
 * validateKintoneAppCredentials — kintone接続作成時、アプリID一覧(kintone_app_ids)とAPIキー
 * (カンマ結合トークン)の対応を検証する。
 *
 * ⚠ 経緯(Codexレビュー指摘・Critical「正本を欠いた接続を成功扱いにできる」): 過去の実装は
 * トークン数とアプリID数が不一致でも接続作成自体は成功させ、kintone_app_tokens(正本)の
 * 書き込みだけを諦めていた。結果、kintone_app_ids と access_token_encrypted(カンマ結合)は
 * あるのに正本が無い「死んだ接続」ができ、以後のアプリ追加/削除がKTGAPで恒久停止し、
 * どのトークンがどのアプリのものか復元不能になっていた。以後は不一致を接続作成時点で拒否する。
 */
describe('validateKintoneAppCredentials', () => {
  it('アプリIDとトークンの数が一致すれば、検証・正規化済みの配列を返す', () => {
    const result = validateKintoneAppCredentials(['5', '9'], 'token-5,token-9')
    expect(result).toEqual({ ok: true, appIds: ['5', '9'], tokens: ['token-5', 'token-9'] })
  })

  it('単一アプリ・単一トークンも許可する', () => {
    const result = validateKintoneAppCredentials(['5'], 'token-5')
    expect(result).toEqual({ ok: true, appIds: ['5'], tokens: ['token-5'] })
  })

  it('トークン数がアプリID数より少なければ拒否する', () => {
    const result = validateKintoneAppCredentials(['5', '9'], 'only-one-token')
    expect(result.ok).toBe(false)
  })

  it('トークン数がアプリID数より多ければ拒否する', () => {
    const result = validateKintoneAppCredentials(['5'], 'token-5,extra-token')
    expect(result.ok).toBe(false)
  })

  it('kintone_app_idsが未指定(配列でない)なら拒否する', () => {
    expect(validateKintoneAppCredentials(undefined, 'token-5').ok).toBe(false)
    expect(validateKintoneAppCredentials('5', 'token-5').ok).toBe(false)
  })

  it('kintone_app_idsが空配列なら拒否する', () => {
    expect(validateKintoneAppCredentials([], 'token-5').ok).toBe(false)
  })

  it('数値以外の不正な形式のアプリIDが混ざっていれば拒否する(黙って捨てない)', () => {
    const result = validateKintoneAppCredentials(['5', 'not-a-number'], 'token-5,token-9')
    expect(result.ok).toBe(false)
  })

  it('桁数が異常に多いアプリIDは拒否する', () => {
    const result = validateKintoneAppCredentials(['1'.repeat(21)], 'token-1')
    expect(result.ok).toBe(false)
  })

  it('重複したアプリIDは拒否する', () => {
    const result = validateKintoneAppCredentials(['5', '5'], 'token-a,token-b')
    expect(result.ok).toBe(false)
  })

  it('アプリIDが10個以上(上限9個超)なら拒否する', () => {
    const appIds = Array.from({ length: 10 }, (_, i) => String(i + 1))
    const tokens = appIds.map((id) => `token-${id}`).join(',')
    const result = validateKintoneAppCredentials(appIds, tokens)
    expect(result.ok).toBe(false)
  })

  it('ちょうど上限の9個は許可する', () => {
    const appIds = Array.from({ length: 9 }, (_, i) => String(i + 1))
    const tokens = appIds.map((id) => `token-${id}`).join(',')
    const result = validateKintoneAppCredentials(appIds, tokens)
    expect(result.ok).toBe(true)
  })

  it('空のトークン要素(連続カンマ・末尾カンマ)は拒否する', () => {
    expect(validateKintoneAppCredentials(['5', '9'], 'token-5,,token-9').ok).toBe(false)
    expect(validateKintoneAppCredentials(['5'], 'token-5,').ok).toBe(false)
  })

  it('制御文字を含むトークンは拒否する(前後の空白はtrimされるため、埋め込み型の制御文字で検証する)', () => {
    const result = validateKintoneAppCredentials(['5'], 'tok\x01en-5')
    expect(result.ok).toBe(false)
  })

  it('異常に長いトークンは拒否する', () => {
    const result = validateKintoneAppCredentials(['5'], 'a'.repeat(1000))
    expect(result.ok).toBe(false)
  })

  it('トークンの前後の空白はtrimする', () => {
    const result = validateKintoneAppCredentials(['5', '9'], ' token-5 , token-9 ')
    expect(result).toEqual({ ok: true, appIds: ['5', '9'], tokens: ['token-5', 'token-9'] })
  })

  it('数値アプリID(number型)も受理して文字列化する', () => {
    const result = validateKintoneAppCredentials([5, 9], 'token-5,token-9')
    expect(result).toEqual({ ok: true, appIds: ['5', '9'], tokens: ['token-5', 'token-9'] })
  })
})
