import { createClient } from '@supabase/supabase-js'
import { SLACK_CONFIG } from '@/lib/slack/config'
import type { SupabaseClient } from '@supabase/supabase-js'

let _supabaseAdmin: ReturnType<typeof createClient> | null = null
function getSupabaseAdmin() {
  if (!_supabaseAdmin) {
    _supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _supabaseAdmin
}

export interface LlmOptions {
  orgId: string
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  maxTokens?: number
  /** 原価内訳用の用途ラベル（例 'digest_extract'）。ai_usage_events に記録される。 */
  purpose?: string
}

export interface LlmResponse {
  content: string
  usage?: { prompt_tokens: number; completion_tokens: number }
}

interface AiConfig {
  provider: string
  model: string
  api_key_encrypted: string
  enabled: boolean
}

// AiConfigError は依存の軽い ./errors に定義（client.ts をモックするテストでも instanceof が壊れないため）。
// 従来どおり client からも import できるよう re-export する。
export { AiConfigError, type AiConfigErrorKind } from './errors'
import { AiConfigError } from './errors'
import { recordAiUsage } from './usage'

export type AiConfigStatus =
  | { configured: true }
  | { configured: false; reason: 'missing' | 'disabled' | 'invalid' | 'error' }

export type AiKeyVerification = 'valid' | 'invalid' | 'unknown'

/**
 * APIキーの妥当性を、保存時にプロバイダーへ安価に疎通確認する（/v1/models を叩くだけ・課金なし）。
 *   200        → valid
 *   401 / 403  → invalid（キーが無効）
 *   その他/例外 → unknown（429/5xx/ネットワーク障害等・判定不能。無効扱いにして punish しない）
 * enabled=true でも「壊れた鍵」を "設定済み(緑)" に見せないための土台。復号済みの平文キーで呼ぶ。
 */
export async function verifyAiKey(provider: string, apiKey: string): Promise<AiKeyVerification> {
  try {
    let res: Response
    if (provider === 'openai') {
      res = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
      })
    } else if (provider === 'anthropic') {
      res = await fetch('https://api.anthropic.com/v1/models', {
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      })
    } else {
      return 'unknown'
    }
    if (res.ok) return 'valid'
    if (res.status === 401 || res.status === 403) return 'invalid'
    return 'unknown'
  } catch {
    return 'unknown'
  }
}

/**
 * org_ai_config の「有無・有効/無効」だけを、APIキーを復号せずに安価に判定する。
 *
 * 自動タスク抽出(channel-digest cron)が動く前提（有効なAI設定）が揃っているかを、
 * セットアップチェックリスト・設定画面・運用ログで可視化するための軽量ステータス。
 * getAiConfig（復号あり・未設定時throw）と違い、こちらは throw せず値で返す＝
 * 「AI未設定で自動タスク化が止まっている」ことを黙って握り潰さないための土台。
 * DBエラー時も throw せず reason:'error' を返す（可視化フロー自体は止めない）。
 *
 * enabled・api_key_encrypted の有無・key_status(妥当性検証結果) を見る（復号はしない・安価なまま）。
 * enabled=true でもキーが空 or 検証で invalid だった行は cron で必ず失敗するため "設定済み(緑)" に見せない。
 * key_status='unverified'（旧データ・疎通判定不能）は valid 側に倒す＝実際に動いている設定を
 * false negative で赤くしない。invalid は「保存時にプロバイダーが認証拒否した」確定情報のときだけ。
 */
export async function getAiConfigStatus(orgId: string): Promise<AiConfigStatus> {
  const { data, error } = await (getSupabaseAdmin() as SupabaseClient)
    .from('org_ai_config')
    .select('enabled, api_key_encrypted, key_status')
    .eq('org_id', orgId)
    .maybeSingle()

  if (error) return { configured: false, reason: 'error' }
  if (!data) return { configured: false, reason: 'missing' }
  const { enabled, api_key_encrypted, key_status } = data as {
    enabled: boolean
    api_key_encrypted: string | null
    key_status: string | null
  }
  if (!api_key_encrypted || api_key_encrypted.trim() === '') return { configured: false, reason: 'missing' }
  if (key_status === 'invalid') return { configured: false, reason: 'invalid' }
  if (!enabled) return { configured: false, reason: 'disabled' }
  return { configured: true }
}

/**
 * Fetch and decrypt the org's AI configuration from DB
 */
async function getAiConfig(orgId: string): Promise<{ provider: string; model: string; apiKey: string }> {
  const { data: config, error } = await (getSupabaseAdmin() as SupabaseClient)
    .from('org_ai_config')
    .select('provider, model, api_key_encrypted, enabled')
    .eq('org_id', orgId)
    .single()

  if (error || !config) {
    throw new AiConfigError('missing', 'AI未設定: この組織にはAI設定が登録されていません')
  }

  const { provider, model, api_key_encrypted, enabled } = config as AiConfig

  if (!enabled) {
    throw new AiConfigError('disabled', 'AI未設定: AI機能が無効になっています')
  }

  // Decrypt the API key using the same RPC as Slack tokens
  const { data: apiKey, error: decryptError } = await (getSupabaseAdmin() as SupabaseClient)
    .rpc('decrypt_slack_token', {
      encrypted: api_key_encrypted,
      secret: SLACK_CONFIG.clientSecret,
    })

  if (decryptError || !apiKey) {
    throw new AiConfigError('decrypt_failed', 'APIキーの復号化に失敗しました')
  }

  return { provider, model, apiKey }
}

/**
 * Call the OpenAI Chat Completions API
 */
async function callOpenAi(
  apiKey: string,
  model: string,
  messages: LlmOptions['messages'],
  maxTokens: number,
): Promise<LlmResponse> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: maxTokens,
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    if (res.status === 429) {
      throw new Error(`OpenAI レート制限: しばらく待ってから再試行してください。${body}`)
    }
    throw new Error(`OpenAI API エラー (${res.status}): ${body}`)
  }

  const data = await res.json()
  const choice = data.choices?.[0]

  return {
    content: choice?.message?.content ?? '',
    usage: data.usage
      ? {
          prompt_tokens: data.usage.prompt_tokens,
          completion_tokens: data.usage.completion_tokens,
        }
      : undefined,
  }
}

/**
 * Call the Anthropic Messages API
 */
async function callAnthropic(
  apiKey: string,
  model: string,
  messages: LlmOptions['messages'],
  maxTokens: number,
): Promise<LlmResponse> {
  // Separate system message from conversation messages
  const systemMessage = messages.find((m) => m.role === 'system')?.content
  const conversationMessages = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role, content: m.content }))

  const body: Record<string, unknown> = {
    model,
    messages: conversationMessages,
    max_tokens: maxTokens,
  }
  if (systemMessage) {
    body.system = systemMessage
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const responseBody = await res.text()
    if (res.status === 429) {
      throw new Error(`Anthropic レート制限: しばらく待ってから再試行してください。${responseBody}`)
    }
    throw new Error(`Anthropic API エラー (${res.status}): ${responseBody}`)
  }

  const data = await res.json()
  const textBlock = data.content?.find((b: { type: string }) => b.type === 'text')

  return {
    content: textBlock?.text ?? '',
    usage: data.usage
      ? {
          prompt_tokens: data.usage.input_tokens,
          completion_tokens: data.usage.output_tokens,
        }
      : undefined,
  }
}

/**
 * Call the LLM using the org's registered provider and API key.
 *
 * Fetches AI config from DB, decrypts the key, and routes to the
 * appropriate provider (OpenAI or Anthropic).
 */
export async function callLlm(options: LlmOptions): Promise<LlmResponse> {
  const { orgId, messages, maxTokens = 1000 } = options
  const { provider, model, apiKey } = await getAiConfig(orgId)

  let response: LlmResponse
  switch (provider) {
    case 'openai':
      response = await callOpenAi(apiKey, model, messages, maxTokens)
      break
    case 'anthropic':
      response = await callAnthropic(apiKey, model, messages, maxTokens)
      break
    default:
      throw new Error(`未対応のAIプロバイダー: ${provider}`)
  }

  // COGS(原価床)実測: トークン使用量を best-effort で記録（失敗しても抽出は壊さない）。
  if (response.usage) {
    await recordAiUsage({
      orgId,
      provider,
      model,
      promptTokens: response.usage.prompt_tokens,
      completionTokens: response.usage.completion_tokens,
      purpose: options.purpose,
    })
  }

  return response
}
