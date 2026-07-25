/**
 * TASK6 の著者情報（コード定義）。
 *
 * E-E-A-T対応: 記事の著者に実在の人物・実績を紐づけ、会社公式サイト
 * （skara.co.jp）の会社概要と突き合わせられる状態にする。
 * 事実のみを書く（経歴の誇張・創作は禁止。出典は skara.co.jp/company）。
 *
 * 表示名は読みやすさ優先で「高橋ゆうこ」、登記名（会社概要・特商法表記）は
 * 「高橋木綿子」。JSON-LD では alternateName で同一人物性を保つ。
 */

export interface Task6Author {
  /** 表示名（記事のクレジット・プロフィールページの見出し） */
  name: string
  /** 登記名（会社概要・特商法ページの表記。JSON-LDのalternateName） */
  legalName: string
  title: string
  /** プロフィール本文（段落ごと） */
  bio: string[]
  /** 本人性を裏付ける外部URL（JSON-LDのsameAs） */
  sameAs: string[]
}

export const PRIMARY_AUTHOR: Task6Author = {
  name: '高橋ゆうこ',
  legalName: '高橋木綿子',
  title: '株式会社ソレカラ 代表取締役 / TASK6 編集責任者',
  bio: [
    '派遣・採用代行の業界で、月間数百名規模の採用業務を統括。その膨大な定型業務を、自らRPA（パソコンの繰り返し作業を自動化する技術）で自動化し、運用してきた実務家。',
    '2020年、株式会社ソレカラを設立。「会社の『それから』を、AIとつくる」を掲げ、中小企業のAI活用を伴走型で支援している（タスク完遂の統合コンサルティング、業務自動化の受託開発、AI内製化教育、採用支援）。',
    'タスク管理サービス「agentpm」とAI秘書の開発・運営に携わる。TASK6では、実際にあった出来事をもとに書くこと、ツールを使わなくても解決できる方法まで書くことを編集方針として、全記事の企画・監修を行っている。',
  ],
  // agentpm.app/company はskara.co.jpトップへの転送のため裏付けにならず含めない
  sameAs: ['https://skara.co.jp/company'],
}

/**
 * 記事の author_name がプロフィールページを持つ著者かどうか。
 * 表示名・登記名のどちらで記録されていてもリンクする。
 */
export function isKnownAuthorName(name: string | null | undefined): boolean {
  if (!name) return false
  return name === PRIMARY_AUTHOR.name || name === PRIMARY_AUTHOR.legalName
}
