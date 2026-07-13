import { createHash } from 'node:crypto'
import { buildDigestDonePostbackData, buildDigestUndoPostbackData } from '@/lib/channels/digest/postback'

/**
 * 日次digest抽出・配信の純粋ロジック（DB/LLM呼び出しを含まない）。
 *
 * prompt injection対策: グループ発言は非信頼入力。digest本文は
 * サーバ側テンプレート合成のみとし、LLM出力からは title 文字列
 * （このファイルでサニタイズ済み）だけを埋め込む。LLMにpush全文を書かせない。
 */

const MAX_TITLE_LENGTH = 50
const MAX_ASSIGNEE_HINT_LENGTH = 30

/**
 * 制御文字(0x00-0x1F, 0x7F)を除去する。
 * 正規表現の制御文字レンジ記法(no-control-regexに抵触しやすく可読性も低い)は避け、
 * 文字コードで明示的に判定する。
 */
function stripControlChars(raw: string): string {
  let stripped = ''
  for (const ch of raw) {
    const code = ch.codePointAt(0) ?? 0
    if (code <= 0x1f || code === 0x7f) continue
    stripped += ch
  }
  return stripped
}

/** 改行・制御文字を除去し、50字に切り詰める */
export function sanitizeDigestTitle(raw: string): string {
  return stripControlChars(raw).trim().slice(0, MAX_TITLE_LENGTH)
}

/** 改行・制御文字を除去し、30字に切り詰める（LLMが読み取った担当者名の自由文字列） */
export function sanitizeAssigneeHint(raw: string): string {
  return stripControlChars(raw).trim().slice(0, MAX_ASSIGNEE_HINT_LENGTH)
}

/**
 * メンション即時タスク化（Stage 2.5 §2）: 本文からbot宛メンション区間を除去し、
 * 残りをsanitizeDigestTitleと同様に整形する。除去後に空になれば空文字を返し、
 * 呼び出し側はタスクを作らずガイダンスを返信する。
 */
export function buildMentionTaskTitle(
  body: string,
  spans: Array<{ index: number; length: number }>,
): string {
  // indexのずれを防ぐため後ろ（indexが大きい方）から除去する
  const sorted = [...spans].sort((a, b) => b.index - a.index)
  let stripped = body
  for (const span of sorted) {
    stripped = stripped.slice(0, span.index) + stripped.slice(span.index + span.length)
  }
  return sanitizeDigestTitle(stripped)
}

export interface DigestSourceMessage {
  index: number
  body: string
}

export interface LlmChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/**
 * LLM抽出プロンプト。申し送り・依頼・期限のある事項のみをJSON配列で返させる。
 */
export function buildDigestExtractionPrompt(messages: DigestSourceMessage[]): LlmChatMessage[] {
  const system =
    'あなたはグループチャットの申し送り抽出アシスタントです。' +
    '与えられたメッセージから、申し送り・依頼・期限のある事項だけを抽出してください。' +
    '雑談・相槌・挨拶は無視してください。' +
    '出力は必ずJSON配列のみとし、各要素は' +
    '{"title": "50字以内の要約", "assignee_hint": "担当者名(不明ならnull)", "source_index": 元メッセージのindex}' +
    'の形式にしてください。他の説明文は一切出力しないでください。'

  const body = messages.map((m) => `[${m.index}] ${m.body}`).join('\n')
  const user = `以下はグループチャットのメッセージ一覧です。JSON配列で申し送りを抽出してください。\n\n${body}`

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
}

export interface ExtractedDigestTask {
  title: string
  assigneeHint: string | null
  sourceIndex: number
}

/**
 * LLM応答をJSON.parseし、配列として検証する。
 * 失敗（JSON壊れ・配列でない）は null を返す（呼び出し側はそのグループをスキップし、例外で全体を止めない）。
 * ```json フェンス付きの応答も許容する。
 */
export function parseLlmDigestExtraction(raw: string): ExtractedDigestTask[] | null {
  const unfenced = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim()

  let parsed: unknown
  try {
    parsed = JSON.parse(unfenced)
  } catch {
    return null
  }

  if (!Array.isArray(parsed)) return null

  const tasks: ExtractedDigestTask[] = []
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    if (typeof record.title !== 'string' || !record.title.trim()) continue
    const assigneeHint =
      typeof record.assignee_hint === 'string' ? sanitizeAssigneeHint(record.assignee_hint) : ''
    tasks.push({
      title: sanitizeDigestTitle(record.title),
      assigneeHint: assigneeHint.length > 0 ? assigneeHint : null,
      sourceIndex: typeof record.source_index === 'number' ? record.source_index : -1,
    })
  }
  return tasks
}

export interface DigestPushItem {
  digestNumber: number
  title: string
}

export function buildDigestPushText(items: DigestPushItem[]): string {
  const lines = items.map((item) => `${item.digestNumber}. ${item.title}`)
  return `おはようございます。今日の申し送りです（${items.length}件）\n${lines.join('\n')}`
}

export interface DigestFlexItem extends DigestPushItem {
  taskId: string
}

const MAX_FLEX_BUTTONS = 10
const MAX_BUTTON_LABEL_LENGTH = 20

/**
 * Flex Message: 上位10件までpostbackボタン化。超過分は「ほか◯件はコンソールで」を表示。
 */
export function buildDigestFlexMessage(items: DigestFlexItem[]): {
  type: 'flex'
  altText: string
  contents: {
    type: 'bubble'
    body: { type: 'box'; layout: 'vertical'; contents: Array<{ type: 'text'; text: string; wrap: boolean }> }
    footer: { type: 'box'; layout: 'vertical'; contents: unknown[] }
  }
} {
  const shown = items.slice(0, MAX_FLEX_BUTTONS)
  const overflow = items.length - shown.length

  const buttons = shown.map((item) => ({
    type: 'button' as const,
    style: 'secondary' as const,
    action: {
      type: 'postback' as const,
      label: `${item.digestNumber}. ${item.title}`.slice(0, MAX_BUTTON_LABEL_LENGTH),
      data: buildDigestDonePostbackData(item.taskId),
      displayText: `完了${item.digestNumber}`,
    },
  }))

  const footerContents: unknown[] = [...buttons]
  if (overflow > 0) {
    footerContents.push({
      type: 'text',
      text: `ほか${overflow}件はコンソールで`,
      size: 'sm',
      color: '#999999',
      wrap: true,
    })
  }

  return {
    type: 'flex',
    altText: `今日の申し送りです（${items.length}件）`,
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [{ type: 'text', text: '完了したものをタップしてください', wrap: true }],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: footerContents,
      },
    },
  }
}

export interface TaskDoneFlexInput {
  title: string
  /** LINE APIから取得したメンバー表示名。取得失敗・匿名メンバーは null（記名無しの従来文言にフォールバック） */
  doneByDisplayName: string | null
  taskId: string
}

/**
 * 完了replyのFlex Message（Stage 2.5 §3-1/3-2）: 記名文言＋「取り消す」ボタン。
 * 誤タップ対策として「押させない」ではなく「誰が押したか見える＋すぐ戻せる」を採る。
 * doneByDisplayNameはLINE APIから来る非信頼文字列のためsanitizeAssigneeHintを通す。
 */
export function buildTaskDoneFlexMessage(input: TaskDoneFlexInput): {
  type: 'flex'
  altText: string
  contents: {
    type: 'bubble'
    body: { type: 'box'; layout: 'vertical'; contents: Array<{ type: 'text'; text: string; wrap: boolean }> }
    footer: { type: 'box'; layout: 'vertical'; contents: unknown[] }
  }
} {
  const title = sanitizeDigestTitle(input.title)
  const displayName = input.doneByDisplayName ? sanitizeAssigneeHint(input.doneByDisplayName) : null
  const bodyText =
    displayName && displayName.length > 0
      ? `${displayName}さんが『${title}』を完了にしました。`
      : `『${title}』を完了にしました。`

  return {
    type: 'flex',
    altText: bodyText,
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [{ type: 'text', text: bodyText, wrap: true }],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'button',
            style: 'secondary',
            action: {
              type: 'postback',
              label: '取り消す',
              data: buildDigestUndoPostbackData(input.taskId),
              displayText: '取り消す',
            },
          },
        ],
      },
    },
  }
}

/**
 * digest push の retryKey を (groupId, JST日付) から決定的に導出する。
 * cronが同日中に再実行されても同じキーになるため、LINE側の二重配信防止が効く
 * （手動リトライ・pg_netの再送等でcronが同日2回走っても同一グループへ二重pushしない）。
 * UUID v4形式に整形しているが、値そのものはハッシュ由来の決定論的な文字列。
 */
export function buildDigestRetryKey(groupId: string, jstDateString: string): string {
  const hex = createHash('sha256').update(`channel-digest:${groupId}:${jstDateString}`).digest('hex')
  const variantNibble = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16)
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `${variantNibble}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-')
}
