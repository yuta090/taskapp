/**
 * Chatwork API クライアント（登録補助）。
 *
 * fetchChatworkAccountId: 登録時に api_token で GET /v2/me を叩き、Bot自身の account_id を得る。
 * 受信Webでの自己ループ防止（webhookHandler の bot_account_id ガード）に使う。副次的に
 * api_token の有効性検証にもなる（無効トークンは null）。
 */
const API_BASE = 'https://api.chatwork.com/v2'

export async function fetchChatworkAccountId(apiToken: string): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE}/me`, {
      headers: { 'X-ChatWorkToken': apiToken },
    })
    if (!res.ok) return null
    const data = (await res.json().catch(() => null)) as { account_id?: number | string } | null
    if (data?.account_id == null) return null
    return String(data.account_id)
  } catch {
    return null
  }
}
