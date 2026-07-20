import type { OutboundResult } from './types'
import { classifyStatus } from './types'

/**
 * Incoming Webhook URL 型チャネル（Discord/Google Chat/Teams）の共通送信ヘルパー。
 *
 * オペレーターが貼り付けたURLをそのまま fetch するため、SSRF を避けるべく
 * https スキーム＋既知ホストのみ許可する（社内IP等への誤送信/悪用を弾く）。
 */
export interface WebhookUrlPostParams {
  url: string
  /** 許可ホストのサフィックス（例: 'discord.com'）。いずれかに一致必須 */
  allowedHostSuffixes: string[]
  /** チャネル固有のJSONペイロード */
  payload: unknown
  label: string
}

export function isAllowedWebhookUrl(url: string, allowedHostSuffixes: string[]): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (u.protocol !== 'https:') return false
  const host = u.hostname.toLowerCase()
  return allowedHostSuffixes.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))
}

export async function postWebhookUrl(params: WebhookUrlPostParams): Promise<OutboundResult> {
  if (!isAllowedWebhookUrl(params.url, params.allowedHostSuffixes)) {
    return { ok: false, permanent: true, error: `${params.label}: disallowed or invalid webhook url` }
  }

  let res: Response
  try {
    res = await fetch(params.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params.payload),
    })
  } catch (e) {
    return { ok: false, permanent: false, error: `network error: ${(e as Error).message}` }
  }

  if (!res.ok) {
    return { ok: false, status: res.status, ...classifyStatus(res.status), error: `${params.label} http ${res.status}` }
  }
  return { ok: true, status: res.status }
}
