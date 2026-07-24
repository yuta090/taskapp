/**
 * Bot Framework activity（Teamsから届くJSON）を取り込みに必要な最小形へ正規化する純関数群。
 *
 * 副作用・I/O は一切持たない（テスト容易性優先）。呼び出し側（route）が JWT 検証を済ませた後に
 * 呼ぶ想定。
 */

export interface TeamsActivityMentionEntity {
  type?: string
  /** mention の表記そのもの（例 "<at>Bot</at>"）。text から取り除く対象。 */
  text?: string
  mentioned?: { id?: string }
}

/** Bot Framework activity JSON（v1の取り込みに必要な最小の形）。 */
export interface TeamsActivity {
  type?: string
  id?: string
  text?: string
  timestamp?: string
  serviceUrl?: string
  channelData?: {
    channel?: { id?: string }
    team?: { id?: string }
    tenant?: { id?: string }
  }
  conversation?: { id?: string }
  from?: { id?: string }
  recipient?: { id?: string }
  entities?: TeamsActivityMentionEntity[]
}

export interface NormalizedTeamsActivity {
  /** claim/取り込みの単位となるグループID。channelData.channel.id 優先、無ければ conversation.id
   *  の ;messageid= より前を使う（スレッド返信でのブレを除去）。 */
  externalGroupId: string
  externalUserId: string | null
  /** activity.from.id が 28: prefix（Bot Framework の bot ID 規約）なら true。 */
  isBot: boolean
  activityId: string | null
  /** mention除去後の本文。activity.text が string でなければ null（=コードになり得ず沈黙）。 */
  text: string | null
  serviceUrl: string | null
  /** Connector への返信先（activity.conversation.id をそのまま。スレッド返信時は ;messageid= を含む）。 */
  conversationId: string | null
  teamId: string | null
  tenantId: string | null
  /** activity.timestamp（ISO文字列）。欠落時は new Date(0).toISOString()。 */
  occurredAt: string
}

const BOT_ID_PREFIX = '28:'
const THREAD_MESSAGE_ID_SEP = ';messageid='

/**
 * 自分（Bot）宛のメンション表記を text から取り除く。メンションは宛先の指定であって合図では
 * ないため、除去後の文字列を厳格文法（合言葉の正準化・完了コマンドのパース）にそのまま渡す
 * 前提（Telegram の stripSelfMention と同思想）。
 *
 * entities が無い/対象メンションが無いときは無加工で返す（fail-safe）。
 */
export function stripTeamsMention(
  text: string,
  entities: TeamsActivityMentionEntity[] | undefined,
  recipientId: string | undefined,
): string {
  if (!entities || !Array.isArray(entities) || !recipientId) return text

  let result = text
  for (const entity of entities) {
    if (
      entity?.type === 'mention' &&
      entity.mentioned?.id === recipientId &&
      typeof entity.text === 'string' &&
      entity.text.length > 0
    ) {
      result = result.split(entity.text).join('')
    }
  }
  return result
}

function resolveExternalGroupId(activity: TeamsActivity): string | null {
  const channelId = activity.channelData?.channel?.id
  if (typeof channelId === 'string' && channelId.length > 0) return channelId

  const conversationId = activity.conversation?.id
  if (typeof conversationId === 'string' && conversationId.length > 0) {
    return conversationId.split(THREAD_MESSAGE_ID_SEP)[0]
  }
  return null
}

/**
 * Bot Framework activity を正規化する。type !== 'message'（conversationUpdate 等）や
 * グループIDが解決できないものは null を返す（呼び出し側が入口で無処理200に畳む）。
 */
export function normalizeTeamsActivity(activity: TeamsActivity): NormalizedTeamsActivity | null {
  if (activity.type !== 'message') return null

  const externalGroupId = resolveExternalGroupId(activity)
  if (!externalGroupId) return null

  const externalUserId = typeof activity.from?.id === 'string' ? activity.from.id : null
  const isBot = typeof externalUserId === 'string' && externalUserId.startsWith(BOT_ID_PREFIX)
  const activityId = typeof activity.id === 'string' ? activity.id : null
  const rawText = typeof activity.text === 'string' ? activity.text : null
  const text =
    rawText !== null ? stripTeamsMention(rawText, activity.entities, activity.recipient?.id) : null
  const serviceUrl = typeof activity.serviceUrl === 'string' ? activity.serviceUrl : null
  const conversationId =
    typeof activity.conversation?.id === 'string' ? activity.conversation.id : null
  const teamId = typeof activity.channelData?.team?.id === 'string' ? activity.channelData.team.id : null
  const tenantId =
    typeof activity.channelData?.tenant?.id === 'string' ? activity.channelData.tenant.id : null
  const occurredAt = typeof activity.timestamp === 'string' ? activity.timestamp : new Date(0).toISOString()

  return {
    externalGroupId,
    externalUserId,
    isBot,
    activityId,
    text,
    serviceUrl,
    conversationId,
    teamId,
    tenantId,
    occurredAt,
  }
}
