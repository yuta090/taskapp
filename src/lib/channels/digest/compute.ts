import { buildDigestDonePostbackData } from '@/lib/channels/digest/postback'

/**
 * 日次digest抽出・配信の純粋ロジック（DB/LLM呼び出しを含まない）。
 *
 * prompt injection対策: グループ発言は非信頼入力。digest本文は
 * サーバ側テンプレート合成のみとし、LLM出力からは title 文字列
 * （このファイルでサニタイズ済み）だけを埋め込む。LLMにpush全文を書かせない。
 */

const MAX_TITLE_LENGTH = 50

/**
 * 改行・制御文字を除去し、50字に切り詰める。
 * 正規表現の制御文字レンジ記法(no-control-regexに抵触しやすく可読性も低い)は避け、
 * 文字コードで明示的に制御文字(0x00-0x1F, 0x7F)だけを取り除く。
 */
export function sanitizeDigestTitle(raw: string): string {
  let stripped = ''
  for (const ch of raw) {
    const code = ch.codePointAt(0) ?? 0
    if (code <= 0x1f || code === 0x7f) continue
    stripped += ch
  }
  return stripped.trim().slice(0, MAX_TITLE_LENGTH)
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
    tasks.push({
      title: sanitizeDigestTitle(record.title),
      assigneeHint: typeof record.assignee_hint === 'string' ? record.assignee_hint : null,
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
