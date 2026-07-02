/**
 * Fire-and-forget: ボールがクライアントに移動した際にメール承認通知をトリガー。
 * hooks内で呼び出す。エラーは吸収してUIに影響させない。
 */

interface FireApprovalEmailParams {
  taskId: string
  spaceId: string
}

export function fireApprovalEmail(params: FireApprovalEmailParams): void {
  fetch('/api/portal/notify-approval', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  }).catch((err) => {
    console.warn('[email-approval] Failed to trigger:', err)
  })
}
