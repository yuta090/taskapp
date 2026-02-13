import { createClient } from '@supabase/supabase-js'
import { SLACK_CONFIG } from '@/lib/slack/config'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export interface LlmOptions {
  orgId: string
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  maxTokens?: number
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

/**
 * Fetch and decrypt the org's AI configuration from DB
 */
async function getAiConfig(orgId: string): Promise<{ provider: string; model: string; apiKey: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: config, error } = await (supabaseAdmin as any)
    .from('org_ai_config')
    .select('provider, model, api_key_encrypted, enabled')
    .eq('org_id', orgId)
    .single()

  if (error || !config) {
    throw new Error('AI未設定: この組織にはAI設定が登録されていません')
  }

  const { provider, model, api_key_encrypted, enabled } = config as AiConfig

  if (!enabled) {
    throw new Error('AI未設定: AI機能が無効になっています')
  }

  // Decrypt the API key using the same RPC as Slack tokens
  const { data: apiKey, error: decryptError } = await supabaseAdmin
    .rpc('decrypt_slack_token', {
      encrypted: api_key_encrypted,
      secret: SLACK_CONFIG.clientSecret,
    })

  if (decryptError || !apiKey) {
    throw new Error('APIキーの復号化に失敗しました')
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

  switch (provider) {
    case 'openai':
      return callOpenAi(apiKey, model, messages, maxTokens)
    case 'anthropic':
      return callAnthropic(apiKey, model, messages, maxTokens)
    default:
      throw new Error(`未対応のAIプロバイダー: ${provider}`)
  }
}
