import { createHash, randomInt } from 'node:crypto'

/**
 * APIキーの文字集合と形。既存のキー（`tsk_` ＋ 英数字32文字）や、
 * それを確かめる仕組み（DBの rpc_validate_api_key・MCPサーバー・CLI）はそのまま使える形にそろえる。
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
const KEY_PREFIX = 'tsk_'
const KEY_BODY_LENGTH = 32
/** 一覧に出す先頭部分の文字数（末尾に "..." を付けて全体は隠す） */
const VISIBLE_PREFIX_LENGTH = 12

/**
 * 画面が、キー本体やハッシュを自分で作って送ってきたときに返す文言。
 * 本番切り替え直後、開きっぱなしの古い画面（ブラウザ側でキーを作る旧版）からの送信を想定している。
 * この文言自体は、その古い画面には出ない（失敗時は画面側の決まった文言「APIキーの作成に失敗しました」を
 * 表示するだけで、サーバーの応答文はそのまま見せていない）。目的は文言を見せることではなく、
 * サーバーが「保存していない・画面に出せない」キーを黙って作らないこと。再読み込みして今の画面を
 * 使えば、鍵の本体はサーバーで作られ、保存したハッシュと画面に出す平文が一致するようになる。
 */
export const STALE_CLIENT_KEY_MESSAGE = '画面が古いため、再読み込みしてからやり直してください'

export interface GeneratedApiKey {
  /** 平文のキー本体。応答で一度だけ返し、DBには保存しない */
  key: string
  /** DBに保存する、平文キーのSHA-256(hex) */
  keyHash: string
  /** 一覧表示用の断片（平文の先頭部分＋"..."） */
  keyPrefix: string
}

/**
 * APIキーを、サーバー側で推測できない乱数から作る。
 * 乱数源は node:crypto の randomInt（暗号学的乱数から一様分布の整数を返す）に固定していて、
 * 外から差し替える手段は無い。文字集合の大きさをそのまま上限として渡すことで、
 * 剰余演算（% 文字数）による偏りも避けている。
 */
export function generateApiKey(): GeneratedApiKey {
  let body = ''
  for (let i = 0; i < KEY_BODY_LENGTH; i++) {
    body += ALPHABET[randomInt(ALPHABET.length)]
  }
  const key = `${KEY_PREFIX}${body}`
  const keyHash = createHash('sha256').update(key).digest('hex')
  const keyPrefix = `${key.slice(0, VISIBLE_PREFIX_LENGTH)}...`
  return { key, keyHash, keyPrefix }
}
