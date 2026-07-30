/**
 * Trello のアプリキーと、ユーザートークンを発行するための許可URL。
 *
 * なぜ専用モジュールが要るか:
 *   Trello のユーザートークンは「どのアプリ(Power-Up)向けに発行されたか」が紐づく。
 *   つまり **TaskApp のアプリキーを載せた許可URL** からでないと、TaskApp で使える
 *   トークンは発行できない。運用者がこのURLへ辿り着く術が無く、接続フォームに
 *   「APIキー」欄だけがある状態＝実質つなげない状態だったので、URLの組み立てを
 *   ここ1箇所に置き、接続フォームとセットアップ手順の両方から参照する。
 *
 * なぜ NEXT_PUBLIC でよいか:
 *   アプリキーは公式ドキュメント上も非秘匿の扱い（"It is ok for your API key to be
 *   publicly available, but a token should never be publicly available."）。秘匿なのは
 *   ユーザートークンの方で、そちらは従来どおり接続ごとに暗号化して保存する。
 *   許可URLは client 側で組み立てるため、キーは client から読める必要がある。
 *
 * ⚠ このモジュールは client 安全に保つ（node 専用の import を足さない）。接続パネル
 *   （client コンポーネント）から読む前提で、adapters.ts 経由の node:dns 混入と同じ罠を
 *   踏まないようにする。
 */

/** 許可画面に出す、許可を求めるアプリの名前。 */
const TRELLO_APP_NAME = 'TaskApp'

/**
 * アプリキー（Power-Up 単位・全org共通）。
 *
 * 既存デプロイの `TRELLO_API_KEY`（server 専用）を優先して読み、無ければ client からも
 * 読める `NEXT_PUBLIC_TRELLO_API_KEY` を使う。これから設定するなら後者だけでよい
 * （server からは同じく process.env で読めるため、2箇所に同じ値を置かずに済む）。
 * client バンドルでは `process.env.TRELLO_API_KEY` は undefined になるので、
 * client では実質 NEXT_PUBLIC のみが効く。
 */
export function getTrelloAppApiKey(): string {
  return process.env.TRELLO_API_KEY || process.env.NEXT_PUBLIC_TRELLO_API_KEY || ''
}

/**
 * ユーザートークンを発行する許可URL。アプリキーが未設定なら null
 * （呼び出し側は「リンクを出さず、設定不足を伝える」判断ができる）。
 *
 * scope は read,write（完了の書き戻しがあるため read だけでは足りない）。
 * expiration は never（期限付きだと、ある日黙って同期が止まる。切るかどうかは
 * 運用者が Trello 側でいつでも決められる）。
 */
export function getTrelloAuthorizeUrl(): string | null {
  const key = getTrelloAppApiKey()
  if (!key) return null

  const url = new URL('https://trello.com/1/authorize')
  url.searchParams.set('key', key)
  url.searchParams.set('name', TRELLO_APP_NAME)
  url.searchParams.set('scope', 'read,write')
  url.searchParams.set('expiration', 'never')
  url.searchParams.set('response_type', 'token')
  return url.toString()
}
