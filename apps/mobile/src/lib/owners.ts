/**
 * ボールを渡すときに rpc_pass_ball へ渡す担当者。
 *
 * rpc_pass_ball は task_owners を「消してから入れ直す」ので、担当者を変えないつもりでも
 * 今の担当者を全員渡す必要がある（空で渡すと担当者が消える）。引数は相手先側・社内側の2つだけで、
 * 代理店・ベンダー側の担当者は渡せない（渡すと消える）ため、いるときは hasOtherSides で知らせる。
 */
import type { BallSide } from '@/types/database'

export function ownerIdsBySide(owners: readonly { side: BallSide; user_id: string }[]): {
  clientOwnerIds: string[]
  internalOwnerIds: string[]
  hasOtherSides: boolean
} {
  const client = new Set<string>()
  const internal = new Set<string>()
  let hasOtherSides = false
  for (const o of owners) {
    if (o.side === 'client') client.add(o.user_id)
    else if (o.side === 'internal') internal.add(o.user_id)
    else hasOtherSides = true
  }
  return { clientOwnerIds: [...client], internalOwnerIds: [...internal], hasOtherSides }
}
