'use client'

import { toast } from 'sonner'

/**
 * 招待リンクを端末のクリップボードにコピーする。
 * メールが送れなかったときに、招待した人が相手へ直接渡すための逃げ道。
 */
export async function copyInviteUrl(url: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(url)
    toast.success('招待リンクをコピーしました')
  } catch (err) {
    console.error('Failed to copy invite link:', err)
    toast.error('コピーできませんでした')
  }
}
