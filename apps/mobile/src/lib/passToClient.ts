/**
 * 相手先にボールを渡す（Web の useTasks.passBall と同じ順）。
 * 1. 今の担当者のまま rpc_pass_ball（担当者を入れ替える RPC なので、全員渡す）
 * 2. 承認依頼メール（/api/portal/notify-approval）
 * 3. Slack への知らせ（送りっぱなし）
 * メールを送れなくてもボールは戻さない（Web と同じ）。送れなかったことだけ返して画面で知らせる。
 */
import type { BallSide } from '@/types/database'
import { ownerIdsBySide } from './owners'

export async function passBallToClient(
  taskId: string,
  deps: {
    getOwners: (taskId: string) => Promise<{ side: BallSide; user_id: string }[]>
    passBall: (args: { clientOwnerIds: string[]; internalOwnerIds: string[] }) => Promise<void>
    notifyApproval: (taskId: string) => Promise<boolean>
    notifySlack: (taskId: string) => void
  }
): Promise<{ emailSent: boolean }> {
  const { clientOwnerIds, internalOwnerIds, hasOtherSides } = ownerIdsBySide(await deps.getOwners(taskId))
  if (hasOtherSides) {
    throw new Error('代理店・ベンダーの担当者がいるタスクは、Web でボールを渡してください')
  }
  await deps.passBall({ clientOwnerIds, internalOwnerIds })
  const emailSent = await deps.notifyApproval(taskId)
  deps.notifySlack(taskId)
  return { emailSent }
}
