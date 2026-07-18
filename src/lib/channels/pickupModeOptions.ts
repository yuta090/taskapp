import type { Feature } from '@/lib/billing/entitlements'
import type { PickupMode } from '@/lib/channels/store'

/**
 * LINE 取り込みモード（pickup_mode）の選択肢定義（②課金導線・秘書コンソール用）。
 *
 * `all_plus_instant`（毎時まとめ＋メンション即時の両方）は pro 以上限定の有料機能
 * （feature: line_pickup_dual_mode）。UI 側の出し分けはここを唯一の真実源にする
 * （表示ロジックとテストを純粋関数で切り出し、サーバ側の 403 ゲートと二重防御にする）。
 */
export interface PickupModeOption {
  value: PickupMode
  label: string
  hint?: string
  requiresFeature?: Feature
}

export const PICKUP_MODE_OPTIONS: readonly PickupModeOption[] = [
  { value: 'off', label: '取り込まない', hint: 'このグループの発言をタスク化しません' },
  {
    value: 'mention_only',
    label: 'メンション時のみ（即時）',
    hint: '秘書メンション時だけ、その場でタスク化します',
  },
  {
    value: 'all',
    label: '毎時まとめて',
    hint: '1時間ごとに会話全文からタスク候補を抽出します',
  },
  {
    value: 'all_plus_instant',
    label: '毎時まとめ＋即時（両方）',
    hint: '毎時抽出に加え、メンション時は即時タスク化します',
    requiresFeature: 'line_pickup_dual_mode',
  },
]

export interface PickupOptionState {
  /** この選択肢を選べないか（未解禁の有料オプション）。 */
  disabled: boolean
  /** 「pro以上」印を付けるか（未解禁かつ未選択の有料オプション）。 */
  needsUpgrade: boolean
}

/**
 * ある選択肢を、org のエンタイトルメントと現在の設定値から評価する。
 * fail-closed（entitled 不明時は未解禁扱いで呼ぶ）を前提にする純関数。
 *
 * 失効しても「現在その値が設定されている」場合は無効化しない（＝別モードへ戻せる）。
 * これは失効時に設定を凍結せず休眠させる方針（entitlements）と一致する。
 */
export function resolvePickupOptionState(
  option: PickupModeOption,
  ctx: { entitled: boolean; current: PickupMode },
): PickupOptionState {
  if (!option.requiresFeature) {
    return { disabled: false, needsUpgrade: false }
  }
  const isCurrent = ctx.current === option.value
  if (ctx.entitled || isCurrent) {
    return { disabled: false, needsUpgrade: false }
  }
  return { disabled: true, needsUpgrade: true }
}
