/**
 * Discord メッセージ → app ingest エンドポイントが受ける正規化イベント。
 *
 * app 側（src/lib/channels/discord/ingestHandler.ts の DiscordIngestEvent）と同一形状。
 * worker は discord.js の Message をこの構造に落とし、HMAC 付きで内部 ingest へ POST する。
 * 帰属（org/space）・claim 償還・Pro ゲートは全て app 側で行う。worker は運搬役に徹する。
 */

export interface IngestEvent {
  type: 'message_create'
  guildId: string | null
  channelId: string
  messageId: string
  author: { id: string; isBot: boolean; displayName?: string }
  content: string
  /** ISO8601（timestamptz 瞬時値）。Discord の createdAt(UTC Date) を素直に ISO 化する。 */
  timestamp: string
}

/**
 * discord.js Message の構造的サブセット（テストで discord.js を import せず済ませるため）。
 * 実行時は discord.js の Message がこの形を満たす。
 */
export interface RawMessageLike {
  id: string
  content: string
  guildId?: string | null
  channelId: string
  createdAt: Date | string
  author: {
    id: string
    bot: boolean
    username?: string
    globalName?: string | null
    displayName?: string
  }
  member?: { displayName?: string } | null
}

function toIso(createdAt: Date | string): string {
  const d = createdAt instanceof Date ? createdAt : new Date(createdAt)
  // 完全な timestamptz 瞬時値の ISO 化。date-only ではないので toISOString が正しい（UTC瞬時）。
  if (Number.isNaN(d.getTime())) return '1970-01-01T00:00:00.000Z'
  return d.toISOString()
}

/** guild(サーバー)所属の表示名を優先し、無ければ globalName / username にフォールバック。 */
function resolveDisplayName(msg: RawMessageLike): string | undefined {
  return (
    msg.member?.displayName ??
    msg.author.displayName ??
    msg.author.globalName ??
    msg.author.username ??
    undefined
  )
}

export function normalizeMessage(msg: RawMessageLike): IngestEvent {
  return {
    type: 'message_create',
    guildId: msg.guildId ?? null,
    channelId: msg.channelId,
    messageId: msg.id,
    author: {
      id: msg.author.id,
      isBot: msg.author.bot,
      displayName: resolveDisplayName(msg),
    },
    content: msg.content,
    timestamp: toIso(msg.createdAt),
  }
}
