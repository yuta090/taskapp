/**
 * Discord REST クライアント（claim 返信用の最小送信）。
 *
 * 受信は Gateway ワーカーだが、claim の確認番号返信・承認完了通知は app 側から REST で送る
 * （Vercel から実行可・Gateway 不要）。共有Bot の bot_token で Create Message する。
 * content は 2000 文字上限。失敗は例外にせず ok:false を返す（返信失敗で取り込み自体を止めない）。
 */
const API_BASE = 'https://discord.com/api/v10'
const DISCORD_MAX = 2000

export interface DiscordSendResult {
  ok: boolean
  status?: number
  messageId?: string
}

export async function sendDiscordChannelMessage(
  botToken: string,
  channelId: string,
  content: string,
): Promise<DiscordSendResult> {
  const trimmed = content.length > DISCORD_MAX ? content.slice(0, DISCORD_MAX - 1) + '…' : content
  try {
    const res = await fetch(`${API_BASE}/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${botToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content: trimmed }),
    })
    if (!res.ok) return { ok: false, status: res.status }
    const body = (await res.json().catch(() => null)) as { id?: string } | null
    return { ok: true, status: res.status, messageId: body?.id }
  } catch {
    return { ok: false }
  }
}
