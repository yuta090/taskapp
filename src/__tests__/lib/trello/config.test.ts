import { describe, it, expect, afterEach, vi } from 'vitest'
import { getTrelloAppApiKey, getTrelloAuthorizeUrl } from '@/lib/trello/config'

/**
 * Trello のアプリキーと、トークン発行の許可URL。
 *
 * Trello のユーザートークンは「どのアプリ(Power-Up)向けか」が紐づくため、TaskApp の
 * アプリキーを載せた許可URLからでないと**使えるトークンを発行できない**。運用者が
 * 自力で取得する術が無かった（＝接続不能だった）ので、URLの組み立てをここに置く。
 *
 * キー自体は公式ドキュメント上も非秘匿（"It is ok for your API key to be publicly
 * available"）。だからこそ client から読める NEXT_PUBLIC_ に置いてよい。秘匿なのは
 * ユーザートークンの方で、そちらは従来どおり接続ごとに暗号化して保存する。
 */
describe('trello/config', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  describe('getTrelloAppApiKey', () => {
    it('NEXT_PUBLIC_TRELLO_API_KEY を読む（client からも許可URLを組めるようにするため）', () => {
      vi.stubEnv('TRELLO_API_KEY', '')
      vi.stubEnv('NEXT_PUBLIC_TRELLO_API_KEY', 'public-app-key')
      expect(getTrelloAppApiKey()).toBe('public-app-key')
    })

    it('既存デプロイの TRELLO_API_KEY も引き続き読む（設定し直しを強制しない）', () => {
      vi.stubEnv('TRELLO_API_KEY', 'server-app-key')
      vi.stubEnv('NEXT_PUBLIC_TRELLO_API_KEY', '')
      expect(getTrelloAppApiKey()).toBe('server-app-key')
    })

    it('どちらも未設定なら空文字（呼び出し側が配線ミスとして扱える）', () => {
      vi.stubEnv('TRELLO_API_KEY', '')
      vi.stubEnv('NEXT_PUBLIC_TRELLO_API_KEY', '')
      expect(getTrelloAppApiKey()).toBe('')
    })
  })

  describe('getTrelloAuthorizeUrl', () => {
    it('キーが無ければ null（リンクごと出さない判断ができる）', () => {
      vi.stubEnv('TRELLO_API_KEY', '')
      vi.stubEnv('NEXT_PUBLIC_TRELLO_API_KEY', '')
      expect(getTrelloAuthorizeUrl()).toBeNull()
    })

    it('読み書き両方・期限なしのトークンを発行する許可URLを組む', () => {
      vi.stubEnv('NEXT_PUBLIC_TRELLO_API_KEY', 'public-app-key')
      const url = new URL(getTrelloAuthorizeUrl()!)

      expect(url.origin + url.pathname).toBe('https://trello.com/1/authorize')
      expect(url.searchParams.get('key')).toBe('public-app-key')
      expect(url.searchParams.get('response_type')).toBe('token')
      // 完了の書き戻しがあるため read だけでは足りない
      expect(url.searchParams.get('scope')).toBe('read,write')
      // 期限付きだと黙って同期が止まる。切るのは運用者の意思に委ねる
      expect(url.searchParams.get('expiration')).toBe('never')
      // 許可画面に「どのアプリに許可するのか」を出す
      expect(url.searchParams.get('name')).toBeTruthy()
    })
  })
})
