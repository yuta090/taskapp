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
 * 割り当ての考え方は「その記事が、そのタイプの詰まりを正面から扱っているか」。主処方を先頭に置く。
 * 記事が書かれ次第ここに足す（載せても未公開ならAPI側で落ちるので、先に書いてよい）。
 * 正本の対応表は `docs/blog/SHINDAN_ARTICLE_MAP.md`。ずれたらそちらに合わせる。
 */
export const SHINDAN_TYPE_ARTICLE_SLUGS: Record<ShindanTypeKey, readonly string[]> = {
  // 主処方: 丸投げ型＝大きな仕事が大きいまま止まる。割り方そのものが正面から効く
  t1: ['wbs-tsukurikata', 'what-is-task-management'],
  // 副処方: 着手が遅れる型にも、締切の引き直しと「先に人へ投げる」が効く。
  // 1行目が書けずに止まっている場合があるので、割り方も候補に入れる
  t2: ['multitask-nigate-capacity', 'task-jouzu-shimekiri', 'wbs-tsukurikata'],
  // 主処方: 駆け込み型＝提出日で締切を引いているために、確認と差し戻しの後半戦で溢れる
  t3: ['task-jouzu-shimekiri'],
  // 主処方: 同時進行型そのものへの処方箋（分解した後に当たる「1日の容量」の壁）
  t4: ['multitask-nigate-capacity'],
  // お見合い型は「誰が次に動くか」が曖昧。相手に投げる順番と確認日の決め方が効く
  t5: ['tax-document-collection-workflow', 'task-jouzu-shimekiri'],
  // 無音型は「詰まっても言い出せない」。通知だけでは担当も完了も残らない話が効く
  t6: ['tax-document-collection-workflow', 'remine-kun-tsukaikata'],
  // ボトルネック型＝上長の確認待ちで止まる。承認日から締切を引く話が正面から効く
  // ボトルネック型＝上長の確認待ち。締切の引き方に加え、計画を直す前提の考え方も効く
  t7: ['task-jouzu-shimekiri', 'what-is-project-management'],
  // 言いっぱなし型＝会話の決定が記録に残らない。チャットの依頼が流れる話が正面から効く。
  // 表への「書き写し」で条件が落ちるのも同じ型なので、エクセルの限界ラインも候補に入れる
  t8: ['remine-kun-tsukaikata', 'notion-task-memo-ka', 'task-kanri-excel-genkai'],
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
