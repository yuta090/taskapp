import { PROCESS_KEYS } from '@/lib/shindan/model'

/**
 * 診断タイプ → TASK6記事（処方箋）の対応表。
 *
 * 正本は `docs/blog/SHINDAN_ARTICLE_MAP.md`（9タイプ×記事の設計）。ここはその実装側の写しで、
 * **診断結果の画面に出す記事の候補と順番**だけを持つ。
 *
 * 設計の分担（リンク切れを構造的に起こさないため）:
 *   - この表: 「どのタイプにどの記事が効くか」の順序付き候補（主処方が先頭）。記事がまだ
 *     書かれていなくても、予定のslugを載せてよい。
 *   - API側(`/api/task6/shindan-articles`): 候補のうち **実際に公開済みのものだけ**を返す。
 *     未公開・予約投稿は落ちるので、画面にリンク切れが出ない。
 *   - 画面側: 0件なら記事セクションごと出さない（空の見出しを残さない）。
 *
 * 記事を書いたら、この表の該当タイプにslugを足すだけで結果画面に出る（DB側の設定は不要）。
 *
 * ⚠ タイプは t1〜t8（PROCESS_KEYS）。t9（量の負荷）は「タイプ」ではなく負荷ゲージで表す
 *   指標なので、診断結果のタイプ一覧に出ず、この表の対象外。
 */

/** 1タイプに出す記事の上限。結果画面の主役はあくまで診断結果なので、リンクで埋めない。 */
export const MAX_ARTICLES_PER_TYPE = 3

type ShindanTypeKey = (typeof PROCESS_KEYS)[number]

/**
 * タイプ別の記事候補（主処方 → 副処方の順）。
 *
 * 現時点で公開済みの記事は「資料回収が遅れる税理士事務所へ｜催促を仕組みに変える5手順」
 * (`tax-document-collection-workflow`) の1本のみ。**催促を仕組みに変える**内容なので、
 * 相手が詰まっても言い出さない t6（無音型）と、担当が曖昧で誰も動かない t5（お見合い型）に
 * 効く処方箋として割り当てる。他タイプは記事が書かれ次第ここに足す（それまでは0件＝
 * 記事セクションを出さない）。
 */
export const SHINDAN_TYPE_ARTICLE_SLUGS: Record<ShindanTypeKey, readonly string[]> = {
  t1: [],
  t2: [],
  t3: [],
  t4: [],
  t5: ['tax-document-collection-workflow'],
  t6: ['tax-document-collection-workflow'],
  t7: [],
  t8: [],
}

/** 診断のタイプキー（t1〜t8）か。URLクエリなど外から来た文字列の検証に使う。 */
export function isShindanTypeKey(value: string): value is ShindanTypeKey {
  return (PROCESS_KEYS as readonly string[]).includes(value)
}

/**
 * タイプに効く記事の候補slug（対応表の順）。知らないタイプは空配列を返す
 * （例外にしない＝結果画面をエラーで落とさない）。
 */
export function articleSlugsForType(type: string): string[] {
  if (!isShindanTypeKey(type)) return []
  return [...SHINDAN_TYPE_ARTICLE_SLUGS[type]]
}
