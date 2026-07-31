import type { ChannelDefinition } from '@/lib/channels/registry'
import type { SecretaryAccountOwner } from '@/lib/channels/commandGuides'
import type { LineSelfServeState } from '@/lib/channels/sharedBotAccess'

/**
 * 「秘書の使い方を、どこに貼ってもらうか」の**判定だけ**を持つ純関数。
 *
 * 発端の困りごと: Discord は秘書のアカウントを当社が持っていて、事務所の方は
 * そのプロフィール欄を編集できない。それなのに画面は「プロフィール欄に貼ってください」と
 * 案内していて、**貼り先が存在しなかった**（要望が未達になっていた）。
 *
 * 判断の分かれ目は「秘書のアカウントを誰が持っているか」の一点:
 *   - 当社が持つ（Discord / Google Chat / 共通LINE）→ プロフィール欄は編集できない。
 *     代わりに、誰でも書ける場所（LINE は「ノート」、Discord は「トピック」…）に貼ってもらう。
 *   - 事務所が自分で登録した（Slack / Chatwork / Telegram / Teams / 自社LINE）
 *     → これまでどおりプロフィール欄が貼り先。
 *
 * ⚠ **貼り先の文言はここに置かない**。場所の呼び名はチャットごとに違うので、文言は
 *   commandGuides.getChannelPastePlacement（チャネル別の単一の真実源）が持つ。
 *   ここに2つ目の文言を置くと、全チャット共通の「グループの説明欄」に逆戻りする。
 *
 * ⚠ 文言は利用者（事務所の担当者）が読む。社内用語（レジストリ・共有Bot・コンソール）は出さない。
 */

/**
 * 秘書のアカウントの持ち主。'platform' = 当社が用意した共通の秘書 / 'org' = 事務所が登録した秘書。
 * 型の正本は commandGuides 側（貼り先の文言がそこにあるため、2つの union に割れないようにする）。
 */
export type BotOwnership = SecretaryAccountOwner

/** 長い版・短い版の呼び名と、どちらを使うかの手がかり。 */
export const PROFILE_TEXT_LONG_LABEL = 'くわしい版'
export const PROFILE_TEXT_LONG_HINT = 'ふだんはこちらを貼ってください'
export const PROFILE_TEXT_SHORT_LABEL = '短い版'
export const PROFILE_TEXT_SHORT_HINT = '字数の少ない欄はこちら'

/**
 * コピーできなかったときの言い方。
 * クリップボードは権限や環境で失敗する。黙って何も起きないと「壊れている」と受け取られるので、
 * 代わりの手順（手で選んでコピー）まで書く。
 */
export const BOT_PROFILE_COPY_FAILED_MESSAGE =
  'コピーできませんでした。文章を選んでコピーしてください。'

/** コピーできたときの言い方。 */
export const BOT_PROFILE_COPIED_MESSAGE = 'コピーしました'

/**
 * レジストリの定義から持ち主を決める。
 * 事務所が資格情報を登録しないチャネル（sharedBotClaim）＝ 当社がアカウントを持つ。
 * 定義が引けないときは 'platform' に倒す（無い貼り先を案内するより、誰でも書ける場所を案内する）。
 */
export function resolveChannelBotOwnership(
  def: Pick<ChannelDefinition, 'sharedBotClaim'> | null | undefined,
): BotOwnership {
  if (!def) return 'platform'
  return def.sharedBotClaim ? 'platform' : 'org'
}

/**
 * LINE だけはレジストリでは決まらない。同じ 'line' でも、
 * 自社LINEを登録済みの事務所（own）と、共通LINEを使う事務所（それ以外）で貼り先が変わる。
 */
export function resolveLineBotOwnership(access: LineSelfServeState): BotOwnership {
  return access === 'own' ? 'org' : 'platform'
}
