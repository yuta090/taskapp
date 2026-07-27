/**
 * 人数枠に当たったときの案内。
 *
 * 上限そのものはDB側（plans.members_limit / clients_limit → rpc_check_org_limits）が
 * 招待の作成・受諾で執行し、英語の例外メッセージを投げる。それをそのまま利用者に見せると
 *   - 英語で何が起きたか分からない
 *   - 「どうすれば増やせるか」が分からない
 *   - HTTPステータスが 400（入力ミス扱い）で、課金起因だと分からない
 * ため、ここで日本語の案内＋`code`＋402（課金起因の拒否・相手先グループ枠と揃える）に畳む。
 *
 * ⚠ 文字列一致でRPCの例外を分類している。RPC側の文言を変えるときは必ずここも直す
 *   （seatLimitMessage.test.ts が両方の文言パターンを回帰で固定する）。
 */
export type SeatLimitCode = 'member_limit_reached' | 'client_limit_reached'

export interface SeatLimitInfo {
  code: SeatLimitCode
  /** 利用者に見せる日本語の案内 */
  message: string
  status: 402
}

const MEMBER_LIMIT_PATTERN = /reached\s+member\s+limit/i
const CLIENT_LIMIT_PATTERN = /reached\s+client\s+limit/i

/**
 * RPC のエラーメッセージが人数枠由来なら案内を返す。該当しなければ null（呼び出し側は従来どおり扱う）。
 *
 * @param context 'create' = 管理者が招待するとき / 'accept' = 招待された本人が参加するとき
 */
export function seatLimitFromRpcError(
  message: string | null | undefined,
  context: 'create' | 'accept',
): SeatLimitInfo | null {
  if (!message) return null

  if (MEMBER_LIMIT_PATTERN.test(message)) {
    return {
      code: 'member_limit_reached',
      message:
        context === 'create'
          ? '追加できるメンバー数の上限に達しています。プランをアップグレードすると増やせます。'
          : 'この組織は追加できるメンバー数の上限に達しています。招待した方（組織の管理者）にご連絡ください。',
      status: 402,
    }
  }

  if (CLIENT_LIMIT_PATTERN.test(message)) {
    return {
      code: 'client_limit_reached',
      message:
        context === 'create'
          ? '追加できる相手先ユーザー数の上限に達しています。プランをアップグレードすると増やせます。'
          : 'この組織は追加できる相手先ユーザー数の上限に達しています。招待した方（組織の管理者）にご連絡ください。',
      status: 402,
    }
  }

  return null
}
