/**
 * Telegram Bot Token 検証（登録補助）。
 *
 * 登録時に bot_token で getMe を叩き、以下を確認する:
 *   - トークン自体の有効性（Slack の verifySlackToken / Chatwork の fetchChatworkAccountId と同役割）。
 *   - privacy mode（グループ内の全メッセージを読めるか＝ can_read_all_group_messages）。
 *     ON（false）だとグループでの拾いが成立しないため fail-closed で登録させない
 *     （BotFather の /setprivacy を Disable してもらう必要がある）。
 * 成功時は getMe の username（Bot自身のusername・自分宛メンション判定に使う）と
 * id（Bot自身のuser id）を返す。
 */
const GET_ME_ENDPOINT = (botToken: string) => `https://api.telegram.org/bot${botToken}/getMe`

export type VerifyTelegramTokenResult =
  | { ok: true; botUsername: string; botId: string }
  | { ok: false; code: 'telegram_token_unverified' | 'telegram_privacy_mode' }

export async function verifyTelegramToken(
  botToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<VerifyTelegramTokenResult> {
  let res: Response
  try {
    res = await fetchImpl(GET_ME_ENDPOINT(botToken))
  } catch {
    return { ok: false, code: 'telegram_token_unverified' }
  }
  if (!res.ok) {
    return { ok: false, code: 'telegram_token_unverified' }
  }

  const body = (await res.json().catch(() => null)) as
    | {
        ok?: boolean
        result?: { id?: number; username?: string; can_read_all_group_messages?: boolean }
      }
    | null
  if (!body || body.ok !== true || !body.result) {
    return { ok: false, code: 'telegram_token_unverified' }
  }

  const { id, username, can_read_all_group_messages: canReadAll } = body.result
  if (!username) {
    return { ok: false, code: 'telegram_token_unverified' }
  }
  if (canReadAll !== true) {
    return { ok: false, code: 'telegram_privacy_mode' }
  }

  return { ok: true, botUsername: username, botId: String(id) }
}
