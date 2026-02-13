import { WebClient } from '@slack/web-api'
import { createClient } from '@supabase/supabase-js'
import { SLACK_CONFIG } from './config'

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

// orgId -> WebClient キャッシュ
const clientCache = new Map<string, { client: WebClient; expiresAt: number }>()
const CACHE_TTL = 10 * 60 * 1000 // 10分

/**
 * orgIdからDB内の暗号化トークンを復号化してWebClientを生成
 */
export async function getSlackClientForOrg(orgId: string): Promise<WebClient> {
  // キャッシュチェック
  const cached = clientCache.get(orgId)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.client
  }

  // DBからトークン取得・復号化
  const { data: workspace, error } = await (getSupabaseAdmin() as any)
    .from('slack_workspaces')
    .select('bot_token_encrypted')
    .eq('org_id', orgId)
    .not('bot_token_encrypted', 'is', null)
    .single()

  if (error || !workspace?.bot_token_encrypted) {
    throw new Error('Slack workspace not configured for this organization')
  }

  // pgcrypto復号化（SLACK_CLIENT_SECRETをキーとして使用）
  const { data: decrypted, error: decryptError } = await (getSupabaseAdmin() as any)
    .rpc('decrypt_slack_token', {
      encrypted: workspace.bot_token_encrypted,
      secret: SLACK_CONFIG.clientSecret,
    })

  if (decryptError || !decrypted) {
    throw new Error('Failed to decrypt Slack token')
  }

  const client = new WebClient(decrypted)

  // キャッシュに保存
  clientCache.set(orgId, {
    client,
    expiresAt: Date.now() + CACHE_TTL,
  })

  return client
}

/**
 * orgIdのキャッシュを無効化（トークン更新時に使用）
 */
export function invalidateSlackClientCache(orgId: string): void {
  clientCache.delete(orgId)
}

/**
 * Slackチャンネルにメッセージを投稿
 */
export async function postSlackMessage(
  orgId: string,
  channelId: string,
  text: string,
  blocks: unknown[],
  threadTs?: string,
): Promise<{ ts: string | undefined; ok: boolean }> {
  const client = await getSlackClientForOrg(orgId)

  const result = await client.chat.postMessage({
    channel: channelId,
    text,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    blocks: blocks as any,
    thread_ts: threadTs,
  })

  return { ts: result.ts, ok: result.ok ?? false }
}

/**
 * Botがアクセス可能なチャンネル一覧を取得（ページネーション対応）
 */
export async function listSlackChannels(
  orgId: string,
): Promise<Array<{ id: string; name: string; is_private: boolean }>> {
  const client = await getSlackClientForOrg(orgId)
  const allChannels: Array<{ id: string; name: string; is_private: boolean }> = []
  let cursor: string | undefined

  do {
    const result = await client.conversations.list({
      types: 'public_channel,private_channel',
      exclude_archived: true,
      limit: 200,
      cursor,
    })

    const channels = (result.channels || []).map((ch) => ({
      id: ch.id!,
      name: ch.name!,
      is_private: ch.is_private ?? false,
    }))
    allChannels.push(...channels)

    cursor = result.response_metadata?.next_cursor || undefined
  } while (cursor)

  return allChannels
}
