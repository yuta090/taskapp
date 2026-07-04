/**
 * セマンティックカラートークン (#88)
 *
 * 製品が最も依存する視覚規約 amber = **クライアント可視** の意味を守るため、
 * amber を他の意味（警告・要対応・保存中）に流用しない。各意味は別トークンで表す。
 *
 * | 意味 | 色相 | 備考 |
 * |------|------|------|
 * | クライアント可視 (CLIENT) | amber | amber-500 を基準アクセントとする（CLAUDE.md と一致） |
 * | 警告 / 要対応 / 接続異常 (WARNING) | orange | gray < orange < red の注意度エスカレーション |
 * | 保存中など一時状態 (SAVING) | neutral(gray) | 低強調・すぐ消える |
 * | 承認アクション (APPROVE_BUTTON) | green | デザインシステム Success=承認 に統一 |
 *
 * 参照: docs/design/DESIGN_SYSTEM.md §1.2 / CLAUDE.md「Amber-500 = client-visible」
 */

/** クライアント可視要素。amber 専用。 */
export const CLIENT = {
  /** アクセント（アイコン・強調） */
  accent: 'text-amber-500',
  /** バッジ（淡色面＋文字） */
  badge: 'bg-amber-50 text-amber-700',
  /** ドット／塗り */
  dot: 'bg-amber-500',
  /** ボーダー */
  border: 'border-amber-200',
} as const

/** 警告・要対応・接続異常。orange（amber と衝突させない）。 */
export const WARNING = {
  /** 文字 */
  text: 'text-orange-600',
  /** バッジ（未読・強め） */
  badge: 'bg-orange-50 text-orange-700',
  /** バッジ（既読・弱め） */
  badgeMuted: 'bg-orange-50/60 text-orange-600',
  /** ドット（点滅は呼び出し側で animate-pulse を付与） */
  dot: 'bg-orange-500',
  /** ボーダー */
  border: 'border-orange-200',
} as const

/** 保存中など一時的な状態。中立色で低強調。 */
export const SAVING = {
  /** 文字 */
  text: 'text-gray-400',
  /** ドット */
  dot: 'bg-gray-400',
} as const

/** 承認の主アクション。green に統一（面ごとの色違いを禁止）。 */
export const APPROVE_BUTTON = {
  /** 塗りボタン（主CTA） */
  solid: 'bg-green-600 hover:bg-green-700 text-white',
  /** 淡色ボタン（インライン／副次） */
  soft: 'text-green-600 bg-green-50 hover:bg-green-100',
} as const
