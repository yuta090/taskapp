/**
 * 共通LINE(共有Bot) の org 単位 利用状態の純粋ロジック。
 * DB 読取（store.getLineSelfServeState）と gating（issue/approval route）が共有する。
 *
 * 状態:
 *   'own'        = org 専用 line account(owner_type='org') が active。共有bot gating の対象外。
 *   'granted'    = 共有bot が存在し、この org は開通済み（申込→当社付与、or 既存利用者を backfill）。
 *   'requested'  = 共有bot は存在するが、この org は申込中（当社の開通待ち）。
 *   'none'       = 共有bot は存在するが、この org は未申込。
 *   'unavailable'= 共有bot(platform line account) 自体がまだ存在しない（プロビジョニング前）。
 */
export type LineSelfServeState = 'own' | 'granted' | 'requested' | 'none' | 'unavailable'
export type SharedBotAccess = 'none' | 'requested' | 'granted'

export function deriveLineSelfServeState(args: {
  hasOwnActiveLineAccount: boolean
  hasPlatformActiveLineAccount: boolean
  sharedBotAccess: SharedBotAccess
}): LineSelfServeState {
  if (args.hasOwnActiveLineAccount) return 'own'
  if (!args.hasPlatformActiveLineAccount) return 'unavailable'
  if (args.sharedBotAccess === 'granted') return 'granted'
  if (args.sharedBotAccess === 'requested') return 'requested'
  return 'none'
}

/**
 * group-claim の発行/承認（＝新規紐付けの確立境界）を許すか。
 * own（自社bot）と granted（開通済み）だけ許可。それ以外は 403。
 * 既存グループ・送信は別経路でこの判定を通さない（＝切らない）。
 */
export function canUseSharedBotClaims(state: LineSelfServeState): boolean {
  return state === 'own' || state === 'granted'
}
